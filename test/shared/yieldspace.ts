const { bignumber, add, subtract, multiply, divide, pow } = require('mathjs')


// https://www.desmos.com/calculator/5nf2xuy6yb
export function sellVYDai(vyDaiReserves: any, fyDaiReserves: any, vyDai: any, timeTillMaturity: any, rate: any): any {
  const fee = bignumber(1000000000000)
  const Z = bignumber(vyDaiReserves)
  const Y = bignumber(fyDaiReserves)
  const T = bignumber(timeTillMaturity)
  const x = bignumber(vyDai)
  const c = bignumber(rate)
  const k = bignumber(1 / (4 * 365 * 24 * 60 * 60)) // 1 / seconds in four years
  const g = bignumber(950 / 1000)
  const t = multiply(k, T)
  const a = subtract(1, multiply(g, t))
  const invA = divide(1, a)
  const Za = multiply(c, pow(Z, a))
  const Ya = pow(Y, a)
  const Zxa = multiply(c, pow(add(Z, x), a))
  const sum = subtract(add(Za, Ya), Zxa)
  const y = subtract(Y, pow(sum, invA))
  const yFee = subtract(y, fee)

  return yFee
}

export function sellVYDaiNormalized(vyDaiReserves: any, fyDaiReserves: any, vyDai: any, timeTillMaturity: any, initialRate: any, currentRate: any): any {
  const c0 = bignumber(initialRate)

  return sellVYDai(
    multiply(bignumber(vyDaiReserves), c0),
    fyDaiReserves,
    multiply(bignumber(vyDai), c0),
    timeTillMaturity,
    divide(bignumber(currentRate), c0)
  )
}

// https://www.desmos.com/calculator/6jlrre7ybt
export function sellFYDai(vyDaiReserves: any, fyDaiReserves: any, fyDai: any, timeTillMaturity: any, rate: any): any {
  const fee = bignumber(1000000000000)
  const Z = bignumber(vyDaiReserves)
  const Y = bignumber(fyDaiReserves)
  const T = bignumber(timeTillMaturity)
  const x = bignumber(fyDai)
  const c = bignumber(rate)
  const k = bignumber(1 / (4 * 365 * 24 * 60 * 60)) // 1 / seconds in four years
  const g = bignumber(1000 / 950)
  const t = multiply(k, T)
  const a = subtract(1, multiply(g, t))
  const invA = divide(1, a)
  const invC = divide(1, c)
  const Za = multiply(c, pow(Z, a))
  const Ya = pow(Y, a)
  const Yxa = pow(add(Y, x), a)
  const sum = add(Za, subtract(Ya, Yxa))
  const y = subtract(Z,  pow(multiply(invC, sum), invA))
  const yFee = subtract(y, fee)

  return yFee
}

export function sellFYDaiNormalized(vyDaiReserves: any, fyDaiReserves: any, fyDai: any, timeTillMaturity: any, initialRate: any, currentRate: any): any {
  const c0 = bignumber(initialRate)
  const invC0 = divide(1, c0)

  return multiply(invC0, sellFYDai(
    multiply(bignumber(vyDaiReserves), c0),
    fyDaiReserves,
    fyDai,
    timeTillMaturity,
    divide(bignumber(currentRate), c0)
  ))
}

// https://www.desmos.com/calculator/0rgnmtckvy
export function buyVYDai(vyDaiReserves: any, fyDaiReserves: any, vyDai: any, timeTillMaturity: any, rate: any): any {
  const fee = bignumber(1000000000000)
  const Z = bignumber(vyDaiReserves)
  const Y = bignumber(fyDaiReserves)
  const T = bignumber(timeTillMaturity)
  const x = bignumber(vyDai)
  const c = bignumber(rate)
  const k = bignumber(1 / (4 * 365 * 24 * 60 * 60)) // 1 / seconds in four years
  const g = bignumber(1000 / 950)
  const t = multiply(k, T)
  const a = subtract(1, multiply(g, t))
  const invA = divide(1, a)
  const Za = multiply(c, pow(Z, a))
  const Ya = pow(Y, a)
  const Zxa = multiply(c, pow(subtract(Z, x), a))
  const sum = subtract(add(Za, Ya), Zxa)
  const y = subtract(pow(sum, invA), Y)
  const yFee = add(y, fee)

  return yFee
}

export function buyVYDaiNormalized(vyDaiReserves: any, fyDaiReserves: any, vyDai: any, timeTillMaturity: any, initialRate: any, currentRate: any): any {
  const c0 = bignumber(initialRate)

  return buyVYDai(
    multiply(bignumber(vyDaiReserves), c0),
    fyDaiReserves,
    multiply(bignumber(vyDai), c0),
    timeTillMaturity,
    divide(bignumber(currentRate), c0)
  )
}

// https://www.desmos.com/calculator/ws5oqj8x5i
export function buyFYDai(vyDaiReserves: any, fyDaiReserves: any, fyDai: any, timeTillMaturity: any, rate: any): any {
  const fee = bignumber(1000000000000)
  const Z = bignumber(vyDaiReserves)
  const Y = bignumber(fyDaiReserves)
  const T = bignumber(timeTillMaturity)
  const x = bignumber(fyDai)
  const c = bignumber(rate)
  const k = bignumber(1 / (4 * 365 * 24 * 60 * 60)) // 1 / seconds in four years
  const g = bignumber(950 / 1000)
  const t = multiply(k, T)
  const a = subtract(1, multiply(g, t))
  const invA = divide(1, a)
  const invC = divide(1, c)
  const Za = multiply(c, pow(Z, a))
  const Ya = pow(Y, a)
  const Yxa = pow(subtract(Y, x), a)
  const sum = add(Za, subtract(Ya, Yxa))
  const y = subtract(pow(multiply(invC, sum), invA), Z)
  const yFee = add(y, fee)

  return yFee
}

export function buyFYDaiNormalized(vyDaiReserves: any, fyDaiReserves: any, fyDai: any, timeTillMaturity: any, initialRate: any, currentRate: any): any {
  const c0 = bignumber(initialRate)
  const invC0 = divide(1, c0)

  return multiply(invC0, buyFYDai(
    multiply(bignumber(vyDaiReserves), c0),
    fyDaiReserves,
    fyDai,
    timeTillMaturity,
    divide(bignumber(currentRate), c0)
  ))
}
