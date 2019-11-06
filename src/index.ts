/* eslint-disable no-console, no-undef */

let count = 0
const sayHi = () => console.log(`the count is ${++count}`)
setInterval(sayHi, 1000 * 60 * 5)

sayHi()
