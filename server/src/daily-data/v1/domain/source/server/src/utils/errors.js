export class ApiError extends Error {
  constructor(statusCode, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Unauthorized') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'Forbidden') => new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);
export const conflict = (message = 'Conflict', details) => new ApiError(409, 'conflict', message, details);
export const preconditionRequired = (message = 'expectedVersion or If-Match is required') =>
  new ApiError(428, 'precondition_required', message);
export const serviceUnavailable = (message = 'Service unavailable') => new ApiError(503, 'service_unavailable', message);

export function toErrorResponse(error) {
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      body: {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      ok: false,
      error: {
        code: 'internal_error',
        message: 'Internal server error',
      },
    },
  };
}
