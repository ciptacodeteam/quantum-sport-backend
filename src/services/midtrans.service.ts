import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '@/env'

const VA_BANKS: Record<string, string> = {
  BCA_VIRTUAL_ACCOUNT: 'bca',
  BNI_VIRTUAL_ACCOUNT: 'bni',
  BRI_VIRTUAL_ACCOUNT: 'bri',
  PERMATA_VIRTUAL_ACCOUNT: 'permata',
  CIMB_VIRTUAL_ACCOUNT: 'cimb',
}

export type MidtransCustomer = {
  name?: string | null
  email?: string | null
  phone?: string | null
}

export type ChargeInput = {
  orderId: string
  amount: number
  channelCode: string
  customer?: MidtransCustomer
  description?: string
  expiryMinutes?: number
  tokenId?: string
}

export type NormalizedCharge = {
  id: string
  transaction_id: string
  order_id: string
  reference_id: string
  status: string
  transaction_status: string
  fraud_status?: string
  channel_code: string
  channel_properties: Record<string, string | undefined>
  actions: Array<{
    type?: string
    descriptor?: string
    value?: string
    url?: string
  }>
  request_amount: number
  currency: string
  created?: string
  redirect_url?: string
  gateway: 'midtrans'
}

type MidtransBody = Record<string, unknown>

export function isSandboxKey(serverKey = env.midtrans.serverKey) {
  return serverKey.startsWith('SB-')
}

export function midtransBaseUrl(serverKey = env.midtrans.serverKey) {
  return isSandboxKey(serverKey)
    ? 'https://api.sandbox.midtrans.com'
    : 'https://api.midtrans.com'
}

export function isSupportedChannel(channelCode: string) {
  const channel = channelCode.toUpperCase()
  return (
    channel in VA_BANKS ||
    channel === 'MANDIRI_VIRTUAL_ACCOUNT' ||
    channel === 'QRIS' ||
    channel === 'QR' ||
    channel === 'CARDS'
  )
}

export function isPaidStatus(status?: string, fraud?: string) {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'settlement') return true
  return normalized === 'capture' && String(fraud || '').toLowerCase() === 'accept'
}

export function amountsMatch(grossAmount: string | number, total: number) {
  const gross = Math.round(Number(grossAmount))
  return Number.isFinite(gross) && gross === total
}

export function validSignature(
  notification: {
    order_id?: string
    status_code?: string
    gross_amount?: string
    signature_key?: string
  },
  serverKey: string,
) {
  const raw = `${notification.order_id ?? ''}${notification.status_code ?? ''}${notification.gross_amount ?? ''}${serverKey}`
  const expected = createHash('sha512').update(raw).digest('hex')
  const actual = String(notification.signature_key || '')
  const a = Buffer.from(expected)
  const b = Buffer.from(actual)
  return a.length === b.length && timingSafeEqual(a, b)
}

function splitName(name?: string | null) {
  const parts = String(name || 'Customer')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  let first = parts[0] || 'Customer'
  let last = parts.slice(1).join(' ')
  if (`${first} ${last}`.trim().length > 30) {
    first = `${first} ${last}`.trim().slice(0, 30)
    last = ''
  }
  return { first_name: first, ...(last ? { last_name: last } : {}) }
}

function phoneForCharge(phone?: string | null) {
  if (!phone) return undefined
  const compact = phone.replace(/\s/g, '')
  const normalized = compact.startsWith('62') ? `+${compact}` : compact
  if (!normalized.startsWith('+62') && !normalized.startsWith('0')) return undefined
  return normalized.slice(0, 30)
}

export function buildChargeBody(input: ChargeInput): MidtransBody {
  const channel = input.channelCode.toUpperCase()
  if (!isSupportedChannel(channel)) {
    throw new Error('Metode pembayaran ini belum tersedia.')
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error('Payment amount must be a positive whole number.')
  }
  if (!/^[A-Za-z0-9_~.-]{1,50}$/.test(input.orderId)) {
    throw new Error('Invalid payment reference.')
  }

  const customer = splitName(input.customer?.name)
  const phone = phoneForCharge(input.customer?.phone)
  const body: MidtransBody = {
    transaction_details: { order_id: input.orderId, gross_amount: input.amount },
    item_details: [
      {
        id: '1',
        price: input.amount,
        quantity: 1,
        name: (input.description || 'Payment').slice(0, 50),
      },
    ],
    customer_details: {
      ...customer,
      ...(input.customer?.email ? { email: input.customer.email } : {}),
      ...(phone ? { phone } : {}),
    },
  }

  if (input.expiryMinutes && channel !== 'CARDS') {
    body.custom_expiry = {
      expiry_duration: input.expiryMinutes,
      unit: 'minute',
    }
  }

  if (channel === 'CARDS') {
    if (!input.tokenId) throw new Error('Card token is required')
    body.payment_type = 'credit_card'
    body.credit_card = { token_id: input.tokenId, authentication: true }
    return body
  }

  if (channel === 'MANDIRI_VIRTUAL_ACCOUNT') {
    body.payment_type = 'echannel'
    body.echannel = {
      bill_info1: 'Payment:',
      bill_info2: input.orderId.slice(0, 30),
    }
    return body
  }

  if (channel === 'QRIS' || channel === 'QR') {
    body.payment_type = 'qris'
    body.qris = { acquirer: 'gopay' }
    return body
  }

  body.payment_type = 'bank_transfer'
  body.bank_transfer = { bank: VA_BANKS[channel] }
  return body
}

export function normalizeCharge(
  channelCode: string,
  response: MidtransBody,
  amount: number,
): NormalizedCharge {
  const vaNumbers = response.va_numbers as
    | Array<{ bank?: string; va_number?: string }>
    | undefined
  const va =
    vaNumbers?.[0]?.va_number ||
    (response.permata_va_number as string | undefined) ||
    (response.bill_key as string | undefined)
  const qrAction = (
    (response.actions as Array<{ name?: string; url?: string }> | undefined) ||
    []
  ).find((action) => action.name === 'generate-qr-code-v2' || action.name === 'generate-qr-code')
  const redirectUrl = response.redirect_url as string | undefined
  const actions: NormalizedCharge['actions'] = []
  if (va) {
    actions.push({
      type: 'PRESENT_TO_CUSTOMER',
      descriptor: 'VIRTUAL_ACCOUNT_NUMBER',
      value: va,
    })
  }
  if (qrAction?.url) {
    actions.push({
      type: 'PRESENT_TO_CUSTOMER',
      descriptor: 'QR_STRING',
      value: qrAction.url,
    })
  }
  if (redirectUrl) {
    actions.push({
      type: 'REDIRECT_CUSTOMER',
      descriptor: 'WEB_URL',
      value: redirectUrl,
      url: redirectUrl,
    })
  }

  return {
    id: String(response.transaction_id || ''),
    transaction_id: String(response.transaction_id || ''),
    order_id: String(response.order_id || ''),
    reference_id: String(response.order_id || ''),
    status: String(response.transaction_status || 'pending').toUpperCase(),
    transaction_status: String(response.transaction_status || ''),
    fraud_status: response.fraud_status as string | undefined,
    channel_code: channelCode.toUpperCase(),
    channel_properties: {
      virtual_account_number: vaNumbers?.[0]?.va_number || (response.permata_va_number as string | undefined),
      account_number: va,
      bank: vaNumbers?.[0]?.bank,
      qr_string: qrAction?.url,
      biller_code: response.biller_code as string | undefined,
      bill_key: response.bill_key as string | undefined,
      expires_at: response.expiry_time as string | undefined,
    },
    actions,
    request_amount: amount,
    currency: 'IDR',
    created: response.transaction_time as string | undefined,
    redirect_url: redirectUrl,
    gateway: 'midtrans',
  }
}

async function midtransRequest(method: string, path: string, body?: MidtransBody) {
  if (!env.midtrans.serverKey) {
    throw new Error(
      'Payment gateway unavailable. Please try again later (missing API key).',
    )
  }
  const response = await fetch(`${midtransBaseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${env.midtrans.serverKey}:`).toString('base64')}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await response.json().catch(() => ({}))) as MidtransBody
  return json
}

function assertChargeOk(json: MidtransBody) {
  const code = String(json.status_code || '')
  if (code === '200' || code === '201') return
  if (code === '402') {
    throw new Error('Payment method is not enabled on the gateway account.')
  }
  if (code === '406') {
    throw new Error('A payment for this invoice already exists. Please try again.')
  }
  throw new Error(String(json.status_message || 'Payment gateway error'))
}

export const midtransService = {
  isSupported: isSupportedChannel,
  clientConfig() {
    return {
      clientKey: env.midtrans.clientKey,
      sandbox: isSandboxKey(),
    }
  },
  async charge(input: ChargeInput) {
    const channel = input.channelCode.toUpperCase()
    const body = buildChargeBody({ ...input, channelCode: channel })
    const json = await midtransRequest('POST', '/v2/charge', body)
    assertChargeOk(json)
    return normalizeCharge(channel, json, input.amount)
  },
  async getStatus(orderId: string) {
    const json = await midtransRequest(
      'GET',
      `/v2/${encodeURIComponent(orderId)}/status`,
    )
    if (String(json.status_code || '') === '404') return null
    return json
  },
  async cancel(orderId: string) {
    const json = await midtransRequest(
      'POST',
      `/v2/${encodeURIComponent(orderId)}/cancel`,
    )
    const code = String(json.status_code || '')
    if (code !== '200' && code !== '202') {
      throw new Error(String(json.status_message || 'Unable to cancel payment'))
    }
    return json
  },
}
