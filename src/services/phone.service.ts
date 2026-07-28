import { env } from '@/env'
import { log } from '@/lib/logger'
import { formatPhoneForFazpass } from '@/lib/utils'
import axios from 'axios'
import {
  GenerateOTPPayload,
  GenerateOTPResponse,
  VerifyOTPPayload,
  VerifyOTPResponse,
} from './dto/phone.service.dto'

export const FAZPASS_API_URL = env.fazpassApiUrl
export const FAZPASS_MERCHANT_KEY = env.fazpassMerchantKey
export const FAZPASS_GATEWAY_KEY = env.fazpassGatewayKey

if (!FAZPASS_API_URL || !FAZPASS_MERCHANT_KEY || !FAZPASS_GATEWAY_KEY) {
  throw new Error('Fazpass configuration is missing')
}

// Fazpass OTP Endpoints (commented out endpoints are not used currently)
const REQUEST_OTP_URL = `${FAZPASS_API_URL}/otp/request`
// const GENERATE_OTP_URL = `${FAZPASS_API_URL}/otp/generate`
const VERIFY_OTP_URL = `${FAZPASS_API_URL}/otp/verify`

function maskPhone(phone: string) {
  if (phone.length <= 6) {
    return phone
  }

  return `${phone.slice(0, 4)}****${phone.slice(-3)}`
}

export async function sendPhoneOtp(
  phone: string,
): Promise<{ requestId: string; code: string }> {
  try {
    const fazpassPhone = formatPhoneForFazpass(phone)
    const payload = new GenerateOTPPayload(fazpassPhone).toJson()

    const response = await axios.post(REQUEST_OTP_URL, payload, {
      headers: {
        authorization: `Bearer ${FAZPASS_MERCHANT_KEY}`,
      },
    })

    if (
      response.status < 200 ||
      response.status >= 300 ||
      response.data?.status !== true
    ) {
      log.error(
        {
          phone: maskPhone(fazpassPhone),
          httpStatus: response.status,
          providerStatus: response.data?.status,
          providerCode: response.data?.code,
          providerMessage: response.data?.message,
        },
        'Fazpass rejected OTP send request',
      )
      throw new Error('Failed to send OTP')
    }

    const responseData = GenerateOTPResponse.fromJson(response.data)
    if (!responseData.getId() || !responseData.getOtp()) {
      log.error(
        {
          phone: maskPhone(fazpassPhone),
          providerResponse: response.data,
        },
        'Fazpass OTP send response missing request ID',
      )
      throw new Error('Failed to send OTP')
    }

    log.info(
      {
        phone: maskPhone(fazpassPhone),
        requestId: responseData.getId(),
        providerStatus: responseData.status,
        providerCode: responseData.code,
        providerMessage: responseData.message,
        channel: responseData.getData().channel,
        provider: responseData.getData().provider,
      },
      'Fazpass OTP send response',
    )

    return {
      requestId: responseData.getId(),
      code: responseData.getOtp(),
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      log.error(
        {
          phone: maskPhone(formatPhoneForFazpass(phone)),
          httpStatus: error.response?.status,
          providerResponse: error.response?.data,
        },
        'Error sending OTP via Fazpass',
      )
    } else {
      log.error(
        {
          phone: maskPhone(formatPhoneForFazpass(phone)),
          error,
        },
        'Error sending OTP via Fazpass',
      )
    }
    throw error
  }
}

export async function verifyPhoneOtp(
  requestId: string,
  otp: string,
): Promise<{ success: boolean; message: string }> {
  try {
    const payload = new VerifyOTPPayload(requestId, otp).toJson()

    const response = await axios.post(VERIFY_OTP_URL, payload, {
      headers: {
        authorization: `Bearer ${FAZPASS_MERCHANT_KEY}`,
      },
    })

    log.info(
      {
        requestId,
        providerStatus: response.data?.status,
        providerMessage: response.data?.message,
        providerCode: response.data?.code,
      },
      'Fazpass OTP verification response',
    )

    const responseData = VerifyOTPResponse.fromJson(response.data)
    const providerMessage =
      typeof responseData.message === 'string' ? responseData.message : ''

    return {
      success: responseData.status === true,
      message: mapFazpassVerifyMessage(providerMessage),
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const providerMessage = error.response?.data?.message
      log.error(
        {
          requestId,
          httpStatus: error.response?.status,
          providerResponse: error.response?.data,
        },
        'Error verifying OTP via Fazpass',
      )
      return {
        success: false,
        message: mapFazpassVerifyMessage(
          typeof providerMessage === 'string'
            ? providerMessage
            : 'Gagal memverifikasi OTP',
        ),
      }
    }

    log.error(`Error verifying OTP: ${error}`)
    throw error
  }
}

function mapFazpassVerifyMessage(message: string): string {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('kadaluarsa') ||
    normalized.includes('expired') ||
    normalized.includes('expire')
  ) {
    return 'Kode OTP sudah kadaluarsa. Silakan kirim ulang.'
  }

  if (
    normalized.includes('sudah diverifikasi') ||
    normalized.includes('has been verified') ||
    normalized.includes('already')
  ) {
    return 'Kode OTP sudah digunakan'
  }

  if (
    normalized.includes('invalid') ||
    normalized.includes('tidak ditemukan') ||
    normalized.includes('salah')
  ) {
    return 'Kode OTP salah'
  }

  return message || 'Gagal memverifikasi OTP'
}
