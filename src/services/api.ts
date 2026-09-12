import axios, { AxiosError } from 'axios';
import { API_CONFIG, ROUTES } from '../constants';
import { storage } from '../utils/storage';

export const api = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = storage.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for global error handling
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string }>) => {
    // Handle 401 Unauthorized globally
    if (error.response?.status === 401) {
      storage.clearAuth();

      // Only redirect if not already on auth pages
      const currentPath = window.location.pathname;
      if (!currentPath.includes('/login') && !currentPath.includes('/register')) {
        window.location.href = ROUTES.LOGIN;
      }
    }

    return Promise.reject(error);
  }
);

// API error payload shape returned by the backend GlobalExceptionFilter.
interface ApiErrorPayload {
  message?: string | string[];
  error?: string;
}

// Type-safe error extraction with storage-aware messaging
export const getErrorMessage = (error: unknown): string => {
  if (error instanceof AxiosError) {
    const data = error.response?.data as ApiErrorPayload | undefined;
    const status = error.response?.status;

    // Prefer server-provided message, but handle both string and array (ValidationPipe) shapes
    let serverMessage: string | undefined;
    if (data) {
      if (typeof data.message === 'string') serverMessage = data.message;
      else if (Array.isArray(data.message)) serverMessage = data.message.join('; ');
      else if (typeof data.error === 'string') serverMessage = data.error;
    }

    // Storage paused / unavailable -> 503 from StorageService.mapS3Error – surface friendly text
    // Do not hide server's detail so users can unpause Supabase or admins can check Render logs
    if (status === 503 && serverMessage) {
      return serverMessage;
    }

    // Map common 540 / 503 char P deserialization legacy message to friendly one for robustness
    // (kept for backward compat until backend redeploys)
    if (serverMessage?.includes("char 'P' is not expected") || serverMessage?.includes('Project paused')) {
      return 'File storage is temporarily paused – the Supabase project is paused due to inactivity. Please unpause it at supabase.com/dashboard or contact support.';
    }

    return serverMessage || error.message || 'An error occurred';
  }
  if (error instanceof Error) {
    // Also catch legacy frontend-wrapped "Upload failed: char 'P'..." strings bubbling up
    if (error.message.includes("char 'P' is not expected") || error.message.includes('Project paused')) {
      return 'File storage is temporarily paused – the Supabase project is paused due to inactivity. Please unpause it at supabase.com/dashboard or contact support.';
    }
    return error.message;
  }
  return 'An unexpected error occurred';
};

// Single source of truth for detecting storage-unavailable messages so the UI offers one consistent
// "paused / retry" experience without spamming or double-wrapping. Used by upload.service and
// useChatAttachments – keep this regex in sync with any new backend userMessage wording.
const STORAGE_UNAVAILABLE_RE =
  /temporarily.*paused|temporarily.*unavailable|(?:^|\D)(503|540)(?:\D|$)|Project paused/i;

/** True when a message already carries friendly storage-unavailable context (e.g. avoid "Upload failed:" double-wrap). */
export const isStorageUnavailableMessage = (message: string): boolean =>
  STORAGE_UNAVAILABLE_RE.test(message);
