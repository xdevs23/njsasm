'use strict'

const validator = require('validator')
const util = require('util')

var curLine = 0

function checkArgumentCount(needs, splitline) {
  if (splitline.length !== needs + 1) {
    console.error(`Line ${curLine}: Expected ${needs} arguments, got ${splitline.length - 1}`)
    process.exit(1)
  }
}

function checkArgumentCountAtLeast(needs, splitline) {
  if (splitline.length < needs + 1) {
    console.error(`Line ${curLine}: Expected at least ${needs} arguments, got ${splitline.length - 1}`)
    process.exit(1)
  }
}

function nicelyPrintObject(obj) {
  console.log(util.inspect(obj,
      /* showHidden */ false,
      /* depth */ null,
      /* colors */ true));
}

function prettyPrintObject(obj) {
  console.log(JSON.stringify(obj, null, 2))
}

var registers = {
  rg0: {value: null},
  rg1: {value: null},
  rg2: {value: null},
  rg3: {value: null},
  rg4: {value: null},
  rg5: {value: null},
  rg6: {value: null},
  rg7: {value: null},
  rg8: {value: null},
  rg9: {value: null}
}

var functions = {}
var currentFunction = {name: null, func: null}

var splitline

function getValueFromSrc(src) {
  var val = src
  switch (val[0]) {
    case '"':
      val = val.substr(1)
      if (val[val.length - 1] === '"') {
        val = val.slice(0, -1)
      }
      break
    default:
      var useRegister = true
      if (validator.isFloat(val)) {
        val = Number.parseFloat(val)
        useRegister = false
      } else if (val === "true" || val == "false") {
        val = (val === "true")
        useRegister = false
      } else if (val[0] === '{') {
        var fullThing = splitline.slice(splitline.indexOf(src)).join(' ')
        if (fullThing[fullThing.length - 1] === '}') {
          try {
            val = JSON.parse(fullThing)
          } catch (e) {
            console.error(`Line ${curLine}: Could not parse JSON: ${e.message}` +
                          `  Bad JSON: ${fullThing}`)
            // Ignore the error at this point and just return null
            val = null
          }
          useRegister = false
        }
      }
      if (useRegister) {
        var registerSplit = val.split('.')
        var registerName = registerSplit[0]
        var srcRegister = registers[registerName]
        if (srcRegister === undefined) {
          console.error(`Line ${curLine}: Invalid source register ${src}, did you mean to put a string in quotes?`)
          process.exit(1)
        }
        val = srcRegister.value
        if (registerSplit.length > 1) {
          var prevItem = registerName
          registerSplit.slice(1).forEach((e) => {
            var subItem = val[e]
            if (subItem === undefined) {
              console.error(`Line ${curLine}: Could not find subitem ${e} in parent ${prevItem}` +
                            `  Item: ${registerSplit.join('.')}`)
              process.exit(1)
            }
            val = subItem
            prevItem = e
          })
        }
        if (val === null) {
          console.error(`Line ${curLine}: Tried using value of register ${src} which is null. ` +
                        `Registers must not be null when used as source.`)
          process.exit(1)
        }
      }
      break
  }
  return val
}

function getRegister(name) {
  var register = registers[name]
  if (register === undefined) {
    console.error(`Line ${curLine}: Register ${name} does not exist, ` +
                `valid registers are ${Object.keys(registers)}`)
    process.exit(1)
  }
  return register
}

function getArgsForMath(splitline) {
  checkArgumentCount(3, splitline)
  var arg1 = getValueFromSrc(splitline[1].trim())
  var arg2 = getValueFromSrc(splitline[2].trim())
  var register = getRegister(splitline[3].trim())
  if (!validator.isFloat(''+arg1) || !validator.isFloat(''+arg2)) {
    console.error(`Line ${curLine}: Can't do math with ${arg2} and ${arg1}, one of those is not a number`)
    process.exit(1)
  }
  return {arg1: Number.parseFloat(arg1), arg2: Number.parseFloat(arg2), register: register}
}

var stack = []

if (process.argv.length < 3) {
  console.error("Please specify the file")
  process.exit(1)
}

function interpretLine(line) {
  if (currentFunction.name !== null) {
    if (line.startsWith("endfunction")) {
      functions[currentFunction.name] = currentFunction.func
      currentFunction.name = currentFunction.func = null
      return
    }
    currentFunction.func.push(line)
    return
  }
  splitline = line.split(' ')
  var command = splitline[0].trim()
  switch (command) {
    case 'mov':
      checkArgumentCountAtLeast(2, splitline)
      var src = splitline[2].trim()
      getRegister(splitline[1].trim()).value = getValueFromSrc(src)
      break
    case 'printreg':
      nicelyPrintObject(registers)
      break
    case 'cmp':
      checkArgumentCount(3, splitline)
      var arg1 = getValueFromSrc(splitline[1].trim())
      var arg2 = getValueFromSrc(splitline[2].trim())
      var register = getRegister(splitline[3].trim())
      register.value = (arg1 === arg2)
      break
    case 'add':
      var args = getArgsForMath(splitline)
      args.register.value = args.arg1 + args.arg2
      break
    case 'sub':
      var args = getArgsForMath(splitline)
      args.register.value = args.arg1 - args.arg2
      break
    case 'mult':
      var args = getArgsForMath(splitline)
      args.register.value = args.arg1 * args.arg2
      break
    case 'div':
      var args = getArgsForMath(splitline)
      if (args.arg2 === 0) {
        console.error(`Line ${curLine}: Can't divide by 0`)
        process.exit(1)
      }
      args.register.value = args.arg1 / args.arg2
      break
    case 'pow':
      var args = getArgsForMath(splitline)
      args.register.value = Math.pow(args.arg1, args.arg2)
      break
    case 'mod':
      var args = getArgsForMath(splitline)
      args.register.value = args.arg1 % args.arg2
      break
    case 'print':
    case 'println':
      process.stdout.write(getValueFromSrc(splitline.slice(1).join(' ')) + (command === "print" ? "" : "\n"))
      break
    case 'newreg':
      checkArgumentCount(1, splitline)
      var arg = splitline[1].trim()
      if (validator.isFloat(arg)) {
        console.error(`Line ${curLine}: Register names must not consist solely of a number. ` +
                      `Make sure it is alphanumeric and not parseable to a numeric data type to fix this.`)
        process.exit(1)
      } else if (!validator.isAlphanumeric(arg)) {
        console.error(`Line ${curLine}: Register names must consist of alphanumeric characters only`)
        process.exit(1)
      }
      registers[arg] = {value: null}
      break
    case 'delreg':
      checkArgumentCount(1, splitline)
      var registerName = splitline[1].trim()
      if (registers[registerName] !== undefined) {
        delete registers[registerName]
      }
      break
    case 'function':
      if (currentFunction.name !== null) {
        console.error(`Line ${curLine}: Functions can't be nested. End function ${currentFunction.name} first`)
        process.exit(1)
      }
      checkArgumentCount(1, splitline)
      currentFunction.name = splitline[1].trim()
      currentFunction.func = []
      break
    case 'call':
      checkArgumentCountAtLeast(1, splitline)
      var funcName = splitline[1].trim()
      var func = functions[funcName]
      if (func === undefined) {
        console.error(`Line ${curLine}: Function ${funcName} not defined. ` +
                      `Make sure it is defined before this call instruction happens.`)
        process.exit(1)
      }
      var parameters = splitline.slice(2)
      stack.push({name: funcName, callingLine: curLine, parameters: parameters})
      func.forEach((funcline) => {
        interpretLine(funcline)
      })
      stack.pop()
      break
    case 'printstack':
      nicelyPrintObject(stack)
      break
    case 'printstacktrace':
      console.log("Stack Trace")
      var stackToPrint = stack.slice().reverse()
      stackToPrint.forEach((sheet) => {
        console.log("  " + sheet.name + ":" + sheet.callingLine)
      })
      break
    case 'printregval':
      checkArgumentCount(1, splitline)
      nicelyPrintObject(getValueFromSrc(splitline[1].trim()))
      break
    default:
      console.error(`Line ${curLine}: Unknown instruction/command ${command}`)
      process.exit(1)
      break
  }
}

var filename = process.argv[2]

var lineReader = require('readline').createInterface({
  input: require('fs').createReadStream(filename)
})

lineReader.on('line', function (line) {
  curLine++
  var trimmedline = line.trim()
  if (trimmedline.length == 0) {
    return
  }
  if (trimmedline[0] === '#' || trimmedline[0] === ';') {
    return
  } else {
    var indexOfSemicolon = trimmedline.indexOf(';')
    if (indexOfSemicolon !== -1) {
      trimmedline = trimmedline.substring(0, indexOfSemicolon).trim()
    }
  }
  interpretLine(trimmedline)
})
