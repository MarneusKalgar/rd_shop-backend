export interface AuthorizeRequest {
  amount: number;
  currency: string;
  orderId: string;
}

export interface AuthorizeResponse {
  paymentId: string;
  status: number;
}

export interface GetPaymentStatusRequest {
  paymentId: string;
}

export interface GetPaymentStatusResponse {
  paymentId: string;
  status: number;
}

export interface PingResponse {
  status: string;
}
