import { describe, expect, it } from 'vitest'
import { clipCell, isNumericCell, tableWindow } from '../shared/clipCell'
import { runErrorMessage } from '../shared/runError'

describe('table cells', () => {
	it('clips long cells and keeps short ones', () => {
		expect(clipCell('short')).toBe('short')
		expect(clipCell('abcdefghij', 5)).toBe('abcd…')
		expect(clipCell('a   b\nc')).toBe('a b c')
		expect(clipCell('abcdef', 1)).toBe('…')
	})

	it('detects numeric cells', () => {
		expect(isNumericCell('12')).toBe(true)
		expect(isNumericCell('-3.5')).toBe(true)
		expect(isNumericCell('1,200')).toBe(true)
		expect(isNumericCell('')).toBe(false)
		expect(isNumericCell('12px')).toBe(false)
		expect(isNumericCell('1,20')).toBe(false)
	})

	it('counts hidden rows', () => {
		expect(tableWindow(3)).toEqual({ count: 3, more: 0 })
		expect(tableWindow(5, 2)).toEqual({ count: 2, more: 3 })
		expect(tableWindow(2, 5)).toEqual({ count: 2, more: 0 })
	})
})

describe('run error text', () => {
	it('uses Error.message and strips a String(error) prefix', () => {
		expect(runErrorMessage(new Error('Type a web address'))).toBe('Type a web address')
		expect(runErrorMessage(new Error('Error: again'))).toBe('again')
		expect(runErrorMessage('Error: from string')).toBe('from string')
		expect(runErrorMessage('plain')).toBe('plain')
	})
})
