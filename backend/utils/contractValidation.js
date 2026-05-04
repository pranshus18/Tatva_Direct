import { ZodError } from 'zod';

export function parseWithSchema(schema, payload) {
  return schema.parse(payload);
}

export function getContractErrorMessage(error, fallbackMessage = 'Invalid request payload') {
  if (error instanceof ZodError) {
    if (!error.issues?.length) return fallbackMessage;
    const issue = error.issues[0];
    const path = issue.path?.length ? `${issue.path.join('.')}: ` : '';
    return `${path}${issue.message}`;
  }
  return error?.message || fallbackMessage;
}

