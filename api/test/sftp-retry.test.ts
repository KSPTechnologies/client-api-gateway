import { describe, it, expect } from 'vitest';
import { isTransientSftpError, RETRY_SCHEDULE_MIN } from '../src/lib/sftp';

// These strings are verbatim last_error values from prod sftp_files — the
// classifier must keep matching the real failure shapes, and must NEVER
// match a Logiwa 4xx data error (those fail fast to failed/ + .error.txt).

describe('isTransientSftpError', () => {
  it('matches the real transient failures from prod history', () => {
    expect(isTransientSftpError('Order saved but Logiwa submission failed: Logiwa API error (520): error code: 520')).toBe(true);
    expect(isTransientSftpError('Order saved but Logiwa submission failed: Logiwa auth failed (502): error code: 502')).toBe(true);
    expect(isTransientSftpError('put: We encountered an internal error. Please try again. (10001)')).toBe(true);
    expect(isTransientSftpError('Order saved but Logiwa submission failed: put: We encountered an internal error. Please try again. (10001)')).toBe(true);
    expect(isTransientSftpError('Logiwa API error (503): Service Unavailable')).toBe(true);
    expect(isTransientSftpError('fetch failed')).toBe(true);
    expect(isTransientSftpError('Logiwa API error (429): too many requests')).toBe(true);
  });

  it('never matches 4xx data errors (client must fix and re-drop)', () => {
    expect(isTransientSftpError('Logiwa API error (400): {"message": "This product is not found: \'B139\'"}')).toBe(false);
    expect(isTransientSftpError('Logiwa API error (400): {"message": "This purchase order code already exists (91776-828869001)"}')).toBe(false);
    expect(isTransientSftpError('Logiwa API error (400): {"message": "Packtype doesn\'t belong to selected product."}')).toBe(false);
    expect(isTransientSftpError('Logiwa API error (400): {"message": "Carrier Not Found"}')).toBe(false);
    expect(isTransientSftpError('Unexpected token < in JSON at position 0')).toBe(false);
    expect(isTransientSftpError('submit failed (404)')).toBe(false);
  });

  it('backoff schedule covers roughly an hour in three attempts', () => {
    expect(RETRY_SCHEDULE_MIN).toEqual([5, 15, 45]);
  });
});
