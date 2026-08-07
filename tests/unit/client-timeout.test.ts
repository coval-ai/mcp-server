import { CovalApiClient } from '../../src/client.js';
import { jest } from '@jest/globals';

describe('CovalApiClient request timeouts', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('aborts an otherwise pending API request after the default timeout', async () => {
    const timeoutController = new AbortController();
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(timeoutController.signal);
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((_input, init) => {
      const requestSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(requestSignal.reason), {
          once: true,
        });
      });
    });
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    const request = client.getRun('run-123');

    expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(timeoutController.signal);

    timeoutController.abort(new DOMException('The operation timed out', 'TimeoutError'));

    await expect(request).rejects.toMatchObject({
      name: 'CovalApiError',
      code: 'REQUEST_TIMEOUT',
      message: 'The Coval API request timed out.',
      status: 504,
    });
  });

  it('maps a timeout while reading the response body', async () => {
    const timeoutController = new AbortController();
    jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutController.signal);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        timeoutController.signal.addEventListener(
          'abort',
          () => controller.error(timeoutController.signal.reason),
          { once: true },
        );
      },
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    const request = client.getRun('run-123');
    timeoutController.abort(new DOMException('The operation timed out', 'TimeoutError'));

    await expect(request).rejects.toMatchObject({
      name: 'CovalApiError',
      code: 'REQUEST_TIMEOUT',
      status: 504,
    });
  });

  it('preserves the explicit Sofia timeout overrides', async () => {
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => new AbortController().signal);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            delegation_token: 'signed.jwt.token',
            delegation_url: 'https://sofia.example.com/v1/external/delegations',
            expires_at: 1234,
            mode: 'read_only',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            contract_version: '1',
            request_id: 'request-123',
            mode: 'read_only',
            summary: 'Inspect the latest run.',
            evidence: [],
            proposed_actions: [],
          }),
          { status: 200 },
        ),
      );
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    await client.consultSofia({ prompt: 'What should I inspect?' });

    expect(timeoutSpy.mock.calls).toEqual([[15_000], [120_000]]);
  });
});
