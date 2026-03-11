import { createClient, type MatrixClient } from "matrix-js-sdk";

const RAW_BASE_URL = import.meta.env.VITE_MATRIX_BASE_URL as string;
const BASE_URL = new URL(RAW_BASE_URL, window.location.origin).toString();

export function createTempMatrixClient(): MatrixClient {
  return createClient({ baseUrl: BASE_URL });
}

export function createAuthedMatrixClient(params: {
  accessToken: string;
  userId: string;
  deviceId: string;
}): MatrixClient {
  return createClient({
    baseUrl: BASE_URL,
    accessToken: params.accessToken,
    userId: params.userId,
    deviceId: params.deviceId,
  });
}
