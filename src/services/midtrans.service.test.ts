import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  amountsMatch,
  buildChargeBody,
  isPaidStatus,
  normalizeCharge,
  snapEnabledPayments,
  validSignature,
} from './midtrans.service'

const key = 'SB-Mid-server-test'

describe('midtrans charge mapping', () => {
  it('verifies the notification signature with the raw gross amount', () => {
    const notice = {
      order_id: 'INV-261026-ABC123',
      status_code: '200',
      gross_amount: '150000.00',
    }
    const signature_key = createHash('sha512')
      .update(`${notice.order_id}${notice.status_code}${notice.gross_amount}${key}`)
      .digest('hex')
    expect(validSignature({ ...notice, signature_key }, key)).toBe(true)
    expect(validSignature({ ...notice, signature_key, gross_amount: '150000' }, key)).toBe(
      false,
    )
  })

  it('maps VA, Mandiri bill, QRIS, and card charges', () => {
    expect(buildChargeBody({
      orderId: 'INV-1',
      amount: 10000,
      channelCode: 'BCA_VIRTUAL_ACCOUNT',
      expiryMinutes: 15,
    })).toMatchObject({
      payment_type: 'bank_transfer',
      bank_transfer: { bank: 'bca' },
      custom_expiry: { expiry_duration: 15, unit: 'minute' },
    })
    expect(buildChargeBody({
      orderId: 'INV-1',
      amount: 10000,
      channelCode: 'MANDIRI_VIRTUAL_ACCOUNT',
    }).payment_type).toBe('echannel')
    expect(buildChargeBody({
      orderId: 'INV-1',
      amount: 10000,
      channelCode: 'QRIS',
    })).toMatchObject({ payment_type: 'qris', qris: { acquirer: 'gopay' } })
    expect(buildChargeBody({
      orderId: 'INV-1',
      amount: 10000,
      channelCode: 'CARDS',
      tokenId: 'token',
      expiryMinutes: 15,
    })).toMatchObject({
      payment_type: 'credit_card',
      credit_card: { token_id: 'token', authentication: true },
    })
    expect(buildChargeBody({
      orderId: 'INV-1',
      amount: 10000,
      channelCode: 'CARDS',
      tokenId: 'token',
      expiryMinutes: 15,
    }).custom_expiry).toBeUndefined()
  })

  it('normalizes VA numbers, QR image URLs, and 3DS redirects', () => {
    const va = normalizeCharge('BCA_VIRTUAL_ACCOUNT', {
      transaction_id: 'txn',
      order_id: 'INV-1',
      transaction_status: 'pending',
      va_numbers: [{ bank: 'bca', va_number: '001234' }],
    }, 10000)
    expect(va.actions[0]).toMatchObject({
      descriptor: 'VIRTUAL_ACCOUNT_NUMBER',
      value: '001234',
    })
    expect(va.channel_properties.virtual_account_number).toBe('001234')

    const mandiri = normalizeCharge('MANDIRI_VIRTUAL_ACCOUNT', {
      transaction_id: 'txn',
      order_id: 'INV-1',
      transaction_status: 'pending',
      bill_key: '123456',
      biller_code: '70012',
    }, 10000)
    expect(mandiri.channel_properties.biller_code).toBe('70012')
    expect(mandiri.actions[0].value).toBe('123456')

    const qr = normalizeCharge('QRIS', {
      transaction_id: 'txn',
      order_id: 'INV-1',
      transaction_status: 'pending',
      actions: [{ name: 'generate-qr-code', url: 'https://qr.example/img' }],
    }, 10000)
    expect(qr.actions[0]).toMatchObject({ descriptor: 'QR_STRING', value: 'https://qr.example/img' })

    const card = normalizeCharge('CARDS', {
      transaction_id: 'txn',
      order_id: 'INV-1',
      transaction_status: 'pending',
      fraud_status: 'accept',
      redirect_url: 'https://bank.example/3ds',
    }, 10000)
    expect(card.redirect_url).toBe('https://bank.example/3ds')
    expect(card.actions[0].type).toBe('REDIRECT_CUSTOMER')
  })

  it('treats settlement and accepted card capture as paid', () => {
    expect(isPaidStatus('settlement')).toBe(true)
    expect(isPaidStatus('capture', 'accept')).toBe(true)
    expect(isPaidStatus('capture', 'challenge')).toBe(false)
    expect(isPaidStatus('pending')).toBe(false)
    expect(amountsMatch('150000.00', 150000)).toBe(true)
    expect(amountsMatch('150000.00', 150001)).toBe(false)
  })

  it('rejects e-wallet channels and card charges without a token', () => {
    expect(() =>
      buildChargeBody({ orderId: 'INV-1', amount: 10000, channelCode: 'DANA' }),
    ).toThrow('belum tersedia')
    expect(() =>
      buildChargeBody({ orderId: 'INV-1', amount: 10000, channelCode: 'CARDS' }),
    ).toThrow('Card token is required')
  })

  it('maps master-data channels to Snap enabled_payments', () => {
    expect(snapEnabledPayments('CIMB_VIRTUAL_ACCOUNT')).toEqual(['cimb_va'])
    expect(snapEnabledPayments('MANDIRI_VIRTUAL_ACCOUNT')).toEqual(['echannel'])
    expect(snapEnabledPayments('QRIS')).toEqual(['other_qris'])
    expect(snapEnabledPayments('CARDS')).toEqual(['credit_card'])
    expect(() => snapEnabledPayments('BSI_VIRTUAL_ACCOUNT')).toThrow('Snap')
  })
})
