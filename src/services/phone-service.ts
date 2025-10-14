import { env } from '@/env'
import { log } from '@/lib/logger'
import axios from 'axios'
import {
  SendOTPPayload,
  SendOTPResponse,
  VerifyOTPPayload,
  VerifyOTPResponse,
} from './dto/phone-service.dto'

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

export async function sendPhoneOtp(
  phone: string,
  otp: string,
): Promise<string> {
  try {
    const payload = new SendOTPPayload(phone, otp, FAZPASS_GATEWAY_KEY).toJson()

    const response = await axios.post(SEND_OTP_URL, payload, {
      headers: {
        authorization: `Bearer ${FAZPASS_MERCHANT_KEY}`,
      },
    })

    if (!response.status) {
      log.error(`Failed to send OTP: ${response}`)
      throw new Error('Failed to send OTP')
    }

    const responseData = SendOTPResponse.fromJson(response.data)
    log.info(`OTP Generation Response: ${responseData}`)

    return responseData.getId()
  } catch (error) {
    log.error(`Error sending OTP: ${error}`)
    throw error
  }
}

export async function verifyGeneratePhoneOtp(
  otpId: string,
  otp: string,
): Promise<boolean> {
  try {
    const payload = new VerifyOTPPayload(otpId, otp).toJson()

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
