import { describe, it, expect } from 'vitest'

describe('Simple Test Suite', () => {
  it('should add numbers correctly', () => {
    const sum = 1 + 2
    expect(sum).toBe(3)
  })

  it('should check string equality', () => {
    const greeting = 'Hello, world!'
    expect(greeting).toBe('Hello, world!')
  })
})
