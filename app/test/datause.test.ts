import { describe, expect, it } from 'vitest'
import { dataUseLine, parseReserve } from '../src/datause.ts'

describe('the data reserve field', () => {
  it('is empty for the default', () => {
    expect(parseReserve('')).toEqual({ ok: true, value: undefined })
    expect(parseReserve('   ')).toEqual({ ok: true, value: undefined })
  })
  it('takes whole bytes from 0 to 1 MiB', () => {
    expect(parseReserve('0')).toEqual({ ok: true, value: 0 })
    expect(parseReserve(' 4096 ')).toEqual({ ok: true, value: 4096 })
    expect(parseReserve(String(1024 * 1024))).toEqual({ ok: true, value: 1024 * 1024 })
  })
  it('refuses anything else, saying what it takes', () => {
    for (const text of ['-1', '1.5', 'lots', String(1024 * 1024 + 1), '4 KiB']) {
      const result = parseReserve(text)
      expect(result.ok, text).toBe(false)
      if (!result.ok) expect(result.problem).toMatch(/0 to 1048576/)
    }
  })
})

describe('the Build panel line', () => {
  it('gives bytes used, capacity and what is free', () => {
    expect(dataUseLine('dev', { used: 9812, capacity: 14036 })).toEqual({ text: 'dev ROM · level data 9,812 of 14,036 bytes (70%), 4,224 free', warning: false })
  })
  it('warns when the section is nearly full', () => {
    expect(dataUseLine('release', { used: 950, capacity: 1000 }).warning).toBe(true)
    expect(dataUseLine('release', { used: 900, capacity: 1000 }).warning).toBe(false)
  })
  it('says when the ROM has no section', () => {
    expect(dataUseLine('dev', null).text).toBe('dev ROM · no level data section: the game does not read its level data from the ROM')
  })
})
