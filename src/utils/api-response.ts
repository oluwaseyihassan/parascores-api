// 1. The Generic Success Response
// We use <T> so you can pass "User" or "Match" or "Tournament" into it.
export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T; // The actual payload
  error?: string; // If something failed
  timestamp: string;
}

// 2. Paginated Response with metadata
export interface PaginatedResponse<T = any> {
  success: boolean;
  message: string;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  timestamp: string;
}

// 3. A Helper to generate responses quickly
export class ResponseUtil {
  static success<T>(data: T, message: string = 'Success'): ApiResponse<T> {
    return {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    };
  }

  static paginated<T>(
    data: T[],
    page: number,
    limit: number,
    total: number,
    message: string = 'Success',
  ): PaginatedResponse<T> {
    return {
      success: true,
      message,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      timestamp: new Date().toISOString(),
    };
  }

  static error(message: string, errorDetails?: any): ApiResponse<null> {
    return {
      success: false,
      message,
      error: errorDetails,
      timestamp: new Date().toISOString(),
    };
  }
}
