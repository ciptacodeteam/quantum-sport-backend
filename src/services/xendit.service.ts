import { env } from '@/env'
import { log } from '@/lib/logger'
import dayjs from 'dayjs'

interface CreateInvoiceRequest {
  externalId: string // Your invoice ID
  amount: number // Amount in rupiah
  payerEmail?: string
  description?: string
  invoiceDuration?: number // in seconds
  callbackVirtualAccountIds?: string[] // for VA payments
  successRedirectUrl?: string
  failureRedirectUrl?: string
  items?: Array<{
    name: string
    quantity: number
    price: number
  }>
  customer?: {
    givenNames: string
    surname?: string
    email?: string
    mobileNumber?: string
  }
}

interface XenditInvoiceResponse {
  id: string
  external_id: string
  user_id: string
  status: 'PENDING' | 'PAID' | 'EXPIRED'
  merchant_name: string
  amount: number
  payer_email?: string
  description?: string
  created: string
  updated: string
  expiry_date?: string
  invoice_url: string
}

interface CreateVirtualAccountRequest {
  externalId: string
  bankCode: string // BCA, BRI, MANDIRI, etc.
  name: string
  expectedAmount?: number
}

interface XenditVirtualAccountResponse {
  id: string
  external_id: string
  owner_id: string
  bank_code: string
  account_number: string
  name: string
  status: 'ACTIVE' | 'INACTIVE'
  expiration_date: string
  is_single_use: boolean
  is_closed: boolean
  currency: string
}

class XenditService {
  private apiKey: string
  private baseUrl = 'https://api.xendit.co'

  constructor() {
    this.apiKey = env.xendit.apiKey
    if (!this.apiKey) {
      log.warn('Xendit API key not configured')
    }
  }

  private getHeaders() {
    return {
      Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
    }
  }

  async createInvoice(data: CreateInvoiceRequest): Promise<XenditInvoiceResponse> {
    try {
      log.info(`Creating Xendit invoice for externalId: ${data.externalId}`)

      const response = await fetch(`${this.baseUrl}/v2/invoices`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          external_id: data.externalId,
          amount: data.amount,
          payer_email: data.payerEmail,
          description: data.description || 'Invoice payment',
          invoice_duration: data.invoiceDuration || 86400, // 24 hours
          success_redirect_url: data.successRedirectUrl,
          failure_redirect_url: data.failureRedirectUrl,
          items: data.items || [],
          customer: data.customer,
          // For VA payments
          ...(data.callbackVirtualAccountIds && {
            callback_virtual_account_ids: data.callbackVirtualAccountIds,
          }),
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        log.error(`Xendit API error: ${response.status} - ${errorText}`)
        throw new Error(`Xendit API error: ${response.status}`)
      }

      const result = await response.json()
      log.info(`Xendit invoice created: ${result.id}`)
      return result
    } catch (error) {
      log.fatal(`Error creating Xendit invoice: ${error}`)
      throw error
    }
  }

  async createVirtualAccount(
    data: CreateVirtualAccountRequest,
  ): Promise<XenditVirtualAccountResponse> {
    try {
      log.info(`Creating Xendit Virtual Account for externalId: ${data.externalId}`)

      const response = await fetch(`${this.baseUrl}/virtual_accounts`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          external_id: data.externalId,
          bank_code: data.bankCode,
          name: data.name,
          expected_amount: data.expectedAmount,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        log.error(`Xendit VA API error: ${response.status} - ${errorText}`)
        throw new Error(`Xendit VA API error: ${response.status}`)
      }

      const result = await response.json()
      log.info(`Xendit VA created: ${result.id}`)
      return result
    } catch (error) {
      log.fatal(`Error creating Xendit Virtual Account: ${error}`)
      throw error
    }
  }

  async getInvoice(invoiceId: string): Promise<XenditInvoiceResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/v2/invoices/${invoiceId}`, {
        method: 'GET',
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        log.error(`Xendit API error: ${response.status} - ${errorText}`)
        throw new Error(`Xendit API error: ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      log.fatal(`Error getting Xendit invoice: ${error}`)
      throw error
    }
  }

  async getVirtualAccount(vaId: string): Promise<XenditVirtualAccountResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/virtual_accounts/${vaId}`, {
        method: 'GET',
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        const errorText = await response.text()
        log.error(`Xendit VA API error: ${response.status} - ${errorText}`)
        throw new Error(`Xendit VA API error: ${response.status}`)
      }

      return await response.json()
    } catch (error) {
      log.fatal(`Error getting Xendit Virtual Account: ${error}`)
      throw error
    }
  }

  verifyCallbackToken(token: string): boolean {
    return token === env.xendit.callbackToken
  }
}

export const xenditService = new XenditService()
export default xenditService

