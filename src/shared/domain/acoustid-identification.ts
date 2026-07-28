export interface AcoustIdArtistCredit {
  readonly id: string | null;
  readonly name: string;
}

export interface AcoustIdReleaseGroup {
  readonly id: string;
  readonly title: string;
  readonly type: string | null;
}

export interface AcoustIdRecordingCandidate {
  readonly acoustId: string;
  readonly recordingId: string | null;
  readonly title: string | null;
  readonly artists: readonly AcoustIdArtistCredit[];
  readonly durationSeconds: number | null;
  readonly releaseGroups: readonly AcoustIdReleaseGroup[];
  readonly score: number;
}
