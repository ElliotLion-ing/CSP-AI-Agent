/**
 * Request Validation Utilities
 * Enhanced validation with clear error messages
 */

export interface ValidationError {
  field: string;
  message: string;
  expected?: string;
  received?: any;
  suggestion?: string;
}

export class RequestValidationError extends Error {
  public errors: ValidationError[];
  public statusCode: number;

  constructor(errors: ValidationError[], statusCode = 400) {
    const message = errors.map(e => `${e.field}: ${e.message}`).join('; ');
    super(message);
    this.name = 'RequestValidationError';
    this.errors = errors;
    this.statusCode = statusCode;
  }

  toJSON() {
    return {
      error: 'Validation Error',
      message: this.message,
      details: this.errors,
    };
  }
}

/**
 * Validate required field
 */
export function validateRequired(
  value: any,
  fieldName: string
): ValidationError | null {
  if (value === undefined || value === null || value === '') {
    return {
      field: fieldName,
      message: `Missing required field: '${fieldName}'`,
      expected: 'non-empty value',
      received: typeof value,
    };
  }
  return null;
}

/**
 * Validate string type
 */
export function validateString(
  value: any,
  fieldName: string
): ValidationError | null {
  if (typeof value !== 'string') {
    return {
      field: fieldName,
      message: `Field '${fieldName}' must be a string`,
      expected: 'string',
      received: typeof value,
    };
  }
  return null;
}

/**
 * Validate enum value
 */
export function validateEnum(
  value: any,
  fieldName: string,
  allowedValues: readonly string[]
): ValidationError | null {
  if (!allowedValues.includes(value)) {
    // Find closest match for suggestion
    const suggestion = findClosestMatch(value, allowedValues);
    
    return {
      field: fieldName,
      message: `Field '${fieldName}' has invalid value`,
      expected: `one of: ${allowedValues.map(v => `'${v}'`).join(', ')}`,
      received: value,
      suggestion: suggestion ? `Did you mean '${suggestion}'?` : undefined,
    };
  }
  return null;
}

/**
 * Validate array type
 */
export function validateArray(
  value: any,
  fieldName: string
): ValidationError | null {
  if (!Array.isArray(value)) {
    return {
      field: fieldName,
      message: `Field '${fieldName}' must be an array`,
      expected: 'array',
      received: typeof value,
    };
  }
  return null;
}

/**
 * Validate object type
 */
export function validateObject(
  value: any,
  fieldName: string
): ValidationError | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      field: fieldName,
      message: `Field '${fieldName}' must be an object`,
      expected: 'object',
      received: Array.isArray(value) ? 'array' : typeof value,
    };
  }
  return null;
}

/**
 * Validate boolean type
 */
export function validateBoolean(
  value: any,
  fieldName: string
): ValidationError | null {
  if (typeof value !== 'boolean') {
    return {
      field: fieldName,
      message: `Field '${fieldName}' must be a boolean`,
      expected: 'boolean (true or false)',
      received: typeof value,
    };
  }
  return null;
}

/**
 * Validate number type
 */
export function validateNumber(
  value: any,
  fieldName: string
): ValidationError | null {
  if (typeof value !== 'number' || isNaN(value)) {
    return {
      field: fieldName,
      message: `Field '${fieldName}' must be a number`,
      expected: 'number',
      received: typeof value,
    };
  }
  return null;
}

/**
 * Find closest string match (simple Levenshtein distance)
 */
function findClosestMatch(
  value: string,
  candidates: readonly string[]
): string | null {
  if (!value || typeof value !== 'string') {
    return null;
  }

  let minDistance = Infinity;
  let closest: string | null = null;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(
      value.toLowerCase(),
      candidate.toLowerCase()
    );
    if (distance < minDistance && distance <= 2) {
      // Only suggest if distance is small
      minDistance = distance;
      closest = candidate;
    }
  }

  return closest;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1, // substitution
          matrix[i]![j - 1]! + 1, // insertion
          matrix[i - 1]![j]! + 1 // deletion
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * Validate SSE connection parameters
 */
export function validateSSEConnectionParams(_body: any): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate Authorization header (will be checked in middleware)
  // No body parameters required for SSE connection

  return errors;
}

/**
 * Validate message parameters
 */
export function validateMessageParams(body: any): ValidationError[] {
  const errors: ValidationError[] = [];

  // sessionId is required
  const sessionIdError = validateRequired(body.sessionId, 'sessionId');
  if (sessionIdError) {
    errors.push(sessionIdError);
  } else {
    const sessionIdTypeError = validateString(body.sessionId, 'sessionId');
    if (sessionIdTypeError) {
      errors.push(sessionIdTypeError);
    }
  }

  // message is required
  const messageError = validateRequired(body.message, 'message');
  if (messageError) {
    errors.push(messageError);
  }

  return errors;
}
