export interface MusicBrainzArtistCandidate {
  readonly artistId: string;
  readonly name: string;
  readonly sortName: string;
  readonly disambiguation: string | null;
  readonly type: string | null;
  readonly country: string | null;
  readonly area: string | null;
  readonly score: number;
}
