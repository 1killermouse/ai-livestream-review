import type { AxiosResponse } from 'axios';

import type {
  AuthStatusResponse,
  AuthSessionResponse,
  BootstrapAccountRequest,
  CreateInternalAccountRequest,
  InternalAccountSummary,
  InternalUser,
  LoginRequest,
} from '@shared/api.interface';

import {
  apiClient,
  clearInternalSessionToken,
  setInternalSessionToken,
} from './http';

export async function getStatus(): Promise<AuthStatusResponse> {
  const response: AxiosResponse<AuthStatusResponse> = await apiClient.get(
    '/api/auth/status',
  );
  return response.data;
}

export async function bootstrap(
  request: BootstrapAccountRequest,
): Promise<InternalUser> {
  const response: AxiosResponse<AuthSessionResponse> = await apiClient.post(
    '/api/auth/bootstrap',
    request,
  );
  setInternalSessionToken(response.data.token);
  return response.data.user;
}

export async function login(request: LoginRequest): Promise<InternalUser> {
  const response: AxiosResponse<AuthSessionResponse> = await apiClient.post(
    '/api/auth/login',
    request,
  );
  setInternalSessionToken(response.data.token);
  return response.data.user;
}

export async function logout(): Promise<void> {
  try {
    await apiClient.post('/api/auth/logout');
  } finally {
    clearInternalSessionToken();
  }
}

export async function listAccounts(): Promise<InternalAccountSummary[]> {
  const response: AxiosResponse<InternalAccountSummary[]> =
    await apiClient.get('/api/auth/accounts');
  return response.data;
}

export async function createAccount(
  request: CreateInternalAccountRequest,
): Promise<InternalAccountSummary> {
  const response: AxiosResponse<InternalAccountSummary> = await apiClient.post(
    '/api/auth/accounts',
    request,
  );
  return response.data;
}
