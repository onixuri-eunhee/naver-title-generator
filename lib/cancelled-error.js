/**
 * 진행 중인 작업이 사용자에 의해 취소되었을 때 던지는 에러.
 * catch 블록에서 if (err instanceof CancelledError) 로 분기한다.
 */
export class CancelledError extends Error {
  constructor(jobId, checkpoint) {
    super(`Job ${jobId} cancelled at ${checkpoint}`);
    this.name = 'CancelledError';
    this.jobId = jobId;
    this.checkpoint = checkpoint;
  }
}
