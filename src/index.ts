/* eslint-disable no-console, no-undef */

let count = 0
const sayHi = (): void => console.log(`the count is ${++count}`)
setInterval(sayHi, 1000 * 60 * 5)

sayHi()
