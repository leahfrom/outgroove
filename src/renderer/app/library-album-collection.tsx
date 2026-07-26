import type { AlbumDiagnostic } from "../../shared/domain/album-diagnostics";
import type { AlbumArtworkThumbnailDto } from "../../shared/contracts/api";
import {
  summarizeAlbumReleaseDate,
  type CatalogAlbum,
} from "../../shared/domain/catalog";

function placeholderTone(id: string): number {
  let hash = 0;
  for (const character of id)
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) | 0;
  return Math.abs(hash) % 6;
}

function albumInitials(title: string): string {
  const words = title.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "OG";
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toLocaleUpperCase() ?? "")
    .join("");
}

export function AlbumArtworkPlaceholder({
  album,
  loading = false,
}: {
  readonly album: Pick<CatalogAlbum, "id" | "title">;
  readonly loading?: boolean;
}): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={`album-artwork-placeholder${loading ? " loading" : ""}`}
      data-tone={placeholderTone(album.id)}
    >
      <span>{albumInitials(album.title)}</span>
    </div>
  );
}

export function AlbumArtwork({
  album,
  artwork,
}: {
  readonly album: Pick<CatalogAlbum, "id" | "title">;
  readonly artwork?: AlbumArtworkThumbnailDto | "loading" | undefined;
}): React.JSX.Element {
  return artwork !== "loading" &&
    artwork?.status === "available" &&
    artwork.dataUrl ? (
    <img
      alt=""
      className="album-artwork"
      draggable={false}
      src={artwork.dataUrl}
    />
  ) : (
    <AlbumArtworkPlaceholder album={album} loading={artwork === "loading"} />
  );
}

export function LibraryAlbumCollection({
  albums,
  artworkByAlbum,
  diagnosticsByAlbum,
  onOpenAlbum,
  registerAlbumTrigger,
}: {
  readonly albums: readonly CatalogAlbum[];
  readonly artworkByAlbum?: ReadonlyMap<
    string,
    AlbumArtworkThumbnailDto | "loading"
  >;
  readonly diagnosticsByAlbum: ReadonlyMap<string, readonly AlbumDiagnostic[]>;
  readonly onOpenAlbum: (album: CatalogAlbum) => void;
  readonly registerAlbumTrigger: (
    albumId: string,
    element: HTMLButtonElement | null,
  ) => void;
}): React.JSX.Element {
  const albumsWithDiagnostics = albums.filter(
    (album) => (diagnosticsByAlbum.get(album.id)?.length ?? 0) > 0,
  ).length;

  return (
    <section
      className="album-collection"
      aria-labelledby="album-collection-title"
    >
      <div className="album-collection-heading">
        <div>
          <p className="eyebrow">Your collection</p>
          <h2 id="album-collection-title">Albums</h2>
          <p>Ordered by album artist, release date, then album title.</p>
        </div>
        <p className="album-quality-summary" aria-live="polite">
          {albumsWithDiagnostics === 0
            ? "No data-quality findings on this page."
            : `${albumsWithDiagnostics} of ${albums.length} albums on this page need review.`}
        </p>
      </div>
      <ul className="album-grid" aria-label="Albums">
        {albums.map((album) => {
          const findings = diagnosticsByAlbum.get(album.id) ?? [];
          const releaseDate = summarizeAlbumReleaseDate(album.tracks);
          const needsAttention = findings.some(
            (finding) => finding.severity === "needs-attention",
          );
          return (
            <li key={album.id}>
              <button
                className="album-card"
                onClick={() => onOpenAlbum(album)}
                ref={(element) => registerAlbumTrigger(album.id, element)}
                type="button"
              >
                <AlbumArtwork
                  album={album}
                  artwork={artworkByAlbum?.get(album.id)}
                />
                <span className="album-card-copy">
                  <h3>{album.title}</h3>
                  <span>{album.albumArtist}</span>
                  <span className="album-card-facts">
                    <span>
                      {releaseDate.status === "consistent"
                        ? releaseDate.value
                        : releaseDate.status === "mixed"
                          ? "Mixed release dates"
                          : "Release date not set"}
                    </span>
                    <span>
                      {album.tracks.length}{" "}
                      {album.tracks.length === 1 ? "track" : "tracks"}
                    </span>
                  </span>
                  {findings.length > 0 && (
                    <span
                      className={`album-quality-status ${
                        needsAttention ? "needs-attention" : "review"
                      }`}
                    >
                      {findings.length}{" "}
                      {findings.length === 1 ? "finding" : "findings"} ·{" "}
                      {needsAttention ? "Needs attention" : "Review suggested"}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
