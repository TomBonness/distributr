export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}

export class NotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFound";
  }
}

export class QuotaExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExceeded";
  }
}

export class StoryConflict extends Error {
  constructor(message = "story was updated concurrently; retry") {
    super(message);
    this.name = "StoryConflict";
  }
}

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}
