'use strict'

/*
 * Custom Assembly interpreter for Node
 * Copyright (C) 2018  Simao Gomes Viana
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

if (process.argv.length < 3) {
  console.error("Please specify the file")
  process.exit(1)
}

var filename = process.argv[2]

const validator = require('validator')
const util = require('util')
const events = require('events')
const { spawn } = require('child_process')

var curLine = 0
var contLine = 0
var preprocessing = true
var subprocesses = 0
var emitter = new events.EventEmitter()

async function syncSleep(ms) {
  await ((ms) => {
    return new Promise(resolve => setTimeout(resolve, ms))
  })(ms)
}

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

var labels = {}

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

async function interpretLine(line) {
  if (preprocessing && currentFunction.name !== null) {
    if (line.startsWith("endfunction")) {
      functions[currentFunction.name] = {func: currentFunction.func, lineNum: currentFunction.lineNum}
      currentFunction.name = currentFunction.func = null
      currentFunction.lineNum = 0
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
      if (!preprocessing) break
      if (currentFunction.name !== null) {
        console.error(`Line ${curLine}: Functions can't be nested. End function ${currentFunction.name} first`)
        process.exit(1)
      }
      checkArgumentCount(1, splitline)
      currentFunction.name = splitline[1].trim()
      currentFunction.func = []
      currentFunction.lineNum = contLine
      break
    case 'call':
    case 'async':
      checkArgumentCountAtLeast(1, splitline)
      var funcName = splitline[1].trim()
      var func = functions[funcName].func
      if (func === undefined) {
        console.error(`Line ${curLine}: Function ${funcName} not defined. ` +
                      `Make sure it is defined before this call instruction happens.`)
        process.exit(1)
      }
      var parameters = splitline.slice(2)
      if (command[0] === 'c') {
        stack.push({name: funcName, callingLine: curLine, parameters: parameters})
        func.forEach((funcline) => {
          interpretLine(funcline)
        })
        stack.pop()
      } else {
        subprocesses++
        (async () => {
        const proc = spawn(process.argv[0], [process.argv[1], filename, funcName])

        proc.stdout.on('data', (data) => {
          process.stdout.write(data)
        })

        proc.stderr.on('data', (data) => {
          process.stderr.write(data)
        })

        proc.on('close', (code) => {
          if (code !== 0) {
            console.error(`Asynchronous function call to ${funcName} exited with code ${code}`)
            process.exit(code)
          }
          subprocesses--
        })
        })()
      }
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
    case 'inc':
    case 'incr':
    case 'dec':
    case 'decr':
      checkArgumentCount(1, splitline)
      var registerName = splitline[1].trim()
      var register = getRegister(registerName)
      if (!validator.isFloat(''+register.value)) {
        console.error(`Line ${curLine}: Can't ${command} non-numeric register value of ${registerName}`)
        process.exit(1)
      }
      if (command[0] === 'i') {
        register.value++
      } else {
        register.value--
      }
      break
    case 'lb':
      checkArgumentCount(1, splitline)
      var labelName = splitline[1].trim()
      labels[labelName] = {line: curLine, contline: contLine}
      break
    case 'jmp':
      checkArgumentCount(1, splitline)
      var labelName = splitline[1].trim()
      var label = labels[labelName]
      if (label === undefined) {
        console.error(`Line ${curLine}: There is no label named ${labelName}. Add the label first.`)
        process.exit(1)
      }
      contLine = label.contline
      break
    case 'rev':
      checkArgumentCount(1, splitline)
      var register = getRegister(splitline[1].trim())
      if ((typeof register.value) === 'number') {
        register.value = (register.value == 0 ? 1 : 0)
      } else if ((typeof register.value) === 'string') {
        register.value = register.value.split('').reverse().join('')
      } else if ((typeof register.value) === 'boolean') {
        register.value = !register.value
      } else {
        register.value = null
      }
      break
    case 'jmpcond':
      checkArgumentCount(2, splitline)
      var labelName = splitline[1].trim()
      var label = labels[labelName]
      if (label === undefined) {
        console.error(`Line ${curLine}: There is no label named ${labelName}. Add the label first.`)
        process.exit(1)
      }
      var val = getRegister(splitline[2].trim()).value
      if ( ((typeof val === 'number') && val !== 0) ||
           ((typeof val === 'boolean') && val === true) ||
           ((typeof val === 'string') && val !== '') ||
           (Array.isArray(val) && val.length > 0) ||
           ((typeof val === 'object') && val != {} && val != null)) {
        contLine = label.contline
      }
      break
    case 'endfunction':
      // Looks like we jumped into a function...
      break
    case 'exit':
    case 'quit':
      if (splitline.length > 1) {
        var exitcodeSpecified = getValueFromSrc(splitline[1].trim())
        if ((typeof exitcodeSpecified) === 'number' && exitcodeSpecified >= 0 && exitcodeSpecified <= 255) {
          process.exit(Number.parseInt(''+exitcodeSpecified))
        } else {
          console.log("NJSASM: Program exited. Result:")
          nicelyPrintObject(exitcodeSpecified)
        }
      }
      process.exit(0)
      break
    case 'sleep':
      checkArgumentCount(1, splitline)
      if (!validator.isInt(splitline[1])) {
        console.error(`Line ${curLine}: Can't sleep, ${splitline[1]} is not a number. Specify it in milliseconds`)
        process.exit(1)
      }
      await syncSleep(Number.parseInt(splitline[1]))
      break
    default:
      console.error(`Line ${curLine}: Unknown instruction/command ${command}`)
      process.exit(1)
      break
  }
}

var lineReader = require('readline').createInterface({
  input: require('fs').createReadStream(filename)
})

var content = []

lineReader.on('line', (line) => {
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
  content.push({line: trimmedline, lineNum: curLine})
})

emitter.on('line', (line) => {
  interpretLine(line)
})

function queueLine(line) {
  emitter.emit('line', line)
}

lineReader.on('close', () => {
  (async () => {
    var isInFunction = false
    emitter.on('process', () => {
      // TODO
    })
    // Register labels and functions first
    for (var i = 0; i < content.length; i++) {
      var l = content[i]
      if (l.line.startsWith('lb ')) {
        contLine = i + 1
        curLine = l.lineNum
        await interpretLine(l.line)
      } else if (l.line.startsWith('function') || currentFunction.name !== null ||
                 l.line.startsWith('endfunction')) {
        contLine = i + 1
        curLine = l.lineNum
        await interpretLine(l.line)
      }
    }
    emitter.emit('process')
    preprocessing = false
    await (async () => {
      if (process.argv.length >= 4) {
        await interpretLine(`call ${process.argv[3]}`)
        process.exit(0)
      } else {
        var inFunction = false
        for (contLine = 1; contLine <= content.length; contLine++) {
          var l = content[contLine - 1]
          if (l.line.startsWith('endfunction')) {
            inFunction = false
            continue
          }
          if (inFunction) continue
          if (l.line.startsWith('function')) {
            inFunction = true
            continue
          }
          curLine = l.lineNum
          await interpretLine(l.line)
        }
      }
    })()
  })()
  if (subprocesses !== 0) {
    console.error(`\nNJSASM: Waiting for ${subprocesses} asynchronous function calls to complete`)
    var waitFunc = () => {
      if (subprocesses !== 0) {
        setTimeout(waitFunc, 50)
      }
    }
    setTimeout(waitFunc, 50)
  }
})


