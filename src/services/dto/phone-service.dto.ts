import { FAZPASS_GATEWAY_KEY } from '../phone-service'

export class GenerateOTPPayload {
  constructor(
    public phone: string,
    public gateway_key: string = FAZPASS_GATEWAY_KEY,
  ) {}

  toJson(): any {
    return {
      phone: this.phone,
      gateway_key: this.gateway_key,
    }
  }

  static fromJson(json: any): GenerateOTPPayload {
    return new GenerateOTPPayload(json.phone, json.gateway_key)
  }

  toString(): string {
    return JSON.stringify(this.toJson())
  }
}

export class OTPData {
  constructor(
    public id: string,
    public otp: string,
    public otp_length: number,
    public prefix: string,
    public channel: string,
    public provider: string,
    public purpose: string,
  ) {}

  toJson(): any {
    return {
      id: this.id,
      otp: this.otp,
      otp_length: this.otp_length,
      prefix: this.prefix,
      channel: this.channel,
      provider: this.provider,
      purpose: this.purpose,
    }
  }
}

export class GenerateOTPResponse {
  constructor(
    public status: boolean,
    public message: string,
    public code: string,
    public data: OTPData,
  ) {}

  static fromJson(json: any): GenerateOTPResponse {
    return new GenerateOTPResponse(
      json.status,
      json.message,
      json.code,
      json.data,
    )
  }

  getOtp(): string {
    return this.data.otp
  }

  getId(): string {
    return this.data.id
  }
  getData(): OTPData {
    return this.data
  }
}

export class SendOTPPayload {
  constructor(
    public phone: string,
    public otp: string,
    public gateway_key: string = FAZPASS_GATEWAY_KEY,
  ) {}

  toJson(): any {
    return {
      phone: this.phone,
      otp: this.otp,
      gateway_key: this.gateway_key,
    }
  }

  static fromJson(json: any): SendOTPPayload {
    return new SendOTPPayload(json.phone, json.otp, json.gateway_key)
  }

  toString(): string {
    return JSON.stringify(this.toJson())
  }
}

export class SendOTPResponse {
  constructor(
    public status: boolean,
    public message: string,
    public code: string,
    public data: OTPData,
  ) {}

  static fromJson(json: any): SendOTPResponse {
    return new SendOTPResponse(
      json.status,
      json.message,
      json.code,
      new OTPData(
        json.data.id,
        json.data.otp,
        json.data.otp_length,
        json.data.prefix,
        json.data.channel,
        json.data.provider,
        json.data.purpose,
      ),
    )
  }

  getOtp(): string {
    return this.data.otp
  }

  getId(): string {
    return this.data.id
  }

  getData(): OTPData {
    return this.data
  }
}

export class VerifyOTPPayload {
  constructor(
    public otp_id: string,
    public otp: string,
  ) {}

  toJson(): any {
    return {
      otp_id: this.otp_id,
      otp: this.otp,
    }
  }

  static fromJson(json: any): VerifyOTPPayload {
    return new VerifyOTPPayload(json.otp_id, json.otp)
  }

  toString(): string {
    return JSON.stringify(this.toJson())
  }
}

export class VerifyOTPResponse {
  constructor(
    public status: boolean,
    public message: string,
    public code: string,
  ) {}

  static fromJson(json: any): VerifyOTPResponse {
    return new VerifyOTPResponse(json.status, json.message, json.code)
  }
}
