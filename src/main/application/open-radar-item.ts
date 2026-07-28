import { isValidMusicBrainzId } from "../../shared/domain/tag-edit";

interface RadarItemIdentityStore {
  getCurrentRadarReleaseGroupId(id: string): string | undefined;
}

interface ExternalUrlOpener {
  open(url: string): Promise<void>;
}

export class OpenRadarItem {
  constructor(
    private readonly store: RadarItemIdentityStore,
    private readonly opener: ExternalUrlOpener,
  ) {}

  async inMusicBrainz(id: string): Promise<{ readonly opened: true }> {
    const releaseGroupId = this.store.getCurrentRadarReleaseGroupId(id);
    if (!releaseGroupId)
      throw new Error("The Radar item is no longer in the current snapshot.");
    if (!isValidMusicBrainzId(releaseGroupId))
      throw new Error("The Radar item has an invalid MusicBrainz identity.");
    const normalizedId = releaseGroupId.toLocaleLowerCase("en-US");
    const url = new URL(
      `/release-group/${normalizedId}`,
      "https://musicbrainz.org",
    );
    await this.opener.open(url.href);
    return { opened: true };
  }
}
