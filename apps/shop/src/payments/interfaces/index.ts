export interface AuthorizeRequest {
  amount: number;
  currency: string;
  orderId: string;
}

export interface AuthorizeResponse {
  paymentId: string;
  status: string;
}

export interface GetPaymentStatusRequest {
  paymentId: string;
}

export interface GetPaymentStatusResponse {
  paymentId: string;
  status: string;
}
