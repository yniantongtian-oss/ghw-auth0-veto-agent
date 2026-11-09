export type CibaAuthorizeRequest = {
  userId: string;
  bindingMessage: string;
  scope: string;
  audience?: string;
  requestedExpiry: number;
  authorizationDetails?: Array<Record<string, string>>;
};

export type CibaAuthorizeResponse = {
  auth_req_id: string;
  expires_in: number;
  interval: number;
};

export type CibaTokenResponse = {
  access_token: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

export interface CibaTransport {
  authorize(request: CibaAuthorizeRequest): Promise<CibaAuthorizeResponse>;
  grant(authReqId: string): Promise<CibaTokenResponse>;
}

export function loginHint(userId: string, domain: string): string {
  const trimmed = domain.replace(/\/$/, "");
  return JSON.stringify({
    format: "iss_sub",
    iss: `https://${trimmed}/`,
    sub: userId,
  });
}
