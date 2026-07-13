import { env } from '@/env'
import { log } from '@/lib/logger'
import { formatPhoneForFazpass } from '@/lib/utils'
import axios from 'axios'
import {
  SendOTPPayload,
  SendOTPResponse,
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
// const REQUEST_OTP_URL = `${FAZPASS_API_URL}/otp/request`;
// const GENERATE_OTP_URL = `${FAZPASS_API_URL}/otp/generate`
const SEND_OTP_URL = `${FAZPASS_API_URL}/otp/send`
const VERIFY_OTP_URL = `${FAZPASS_API_URL}/otp/verify`

function maskPhone(phone: string) {
  if (phone.length <= 6) {
    return phone
  }

  return `${phone.slice(0, 4)}****${phone.slice(-3)}`
}

export async function sendPhoneOtp(
  phone: string,
  otp: string,
): Promise<string> {
  try {
    const fazpassPhone = formatPhoneForFazpass(phone)
    const payload = new SendOTPPayload(
      fazpassPhone,
      otp,
      FAZPASS_GATEWAY_KEY,
    ).toJson()

    const response = await axios.post(SEND_OTP_URL, payload, {
      headers: {
        authorization: `Bearer ${FAZPASS_MERCHANT_KEY}`,
      },
    })

    if (!response.status || response.data?.status === false) {
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

    const responseData = SendOTPResponse.fromJson(response.data)
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

    return responseData.getId()
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
      log.error(`Error sending OTP: ${error}`)
    }
    throw error
  }
}

export async function verifyPhoneOtp(
  requestId: string,
  otp: string,
): Promise<boolean> {
  try {
    const payload = new VerifyOTPPayload(requestId, otp).toJson()

    const response = await axios.post(VERIFY_OTP_URL, payload, {
      headers: {
        authorization: `Bearer ${FAZPASS_MERCHANT_KEY}`,
      },
    })

    log.info('OTP Verification Response:', response.data)

    const responseData = VerifyOTPResponse.fromJson(response.data)

    return responseData.status
  } catch (error) {
    log.error(`Error verifying OTP: ${error}`)
    throw error
  }
}
