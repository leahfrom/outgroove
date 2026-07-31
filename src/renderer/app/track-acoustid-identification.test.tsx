// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  AcoustIdTrackLookupResultDto,
  AcoustIdTrackPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogTrack } from "../../shared/domain/catalog";
import { TrackAcoustIdIdentification } from "./track-acoustid-identification";

const track: CatalogTrack = {
  id: "d3a52a1d-f00b-46d8-ac01-e848675a2139",
  path: "/fixture/track.flac",
  size: 100,
  modifiedMs: 1,
  format: "FLAC",
  durationSeconds: 12,
  tags: {
    title: "Fixture Track",
    album: "Fixture Album",
    artist: "Fixture Artist",
    albumArtist: "Fixture Artist",
    trackNumber: null,
    discNumber: null,
    year: null,
  },
  nativeTags: [],
  scanError: null,
};

const preview: AcoustIdTrackPreviewDto = {
  operationId: "11111111-1111-4111-8111-111111111111",
  confirmationToken: "confirmation-token-with-enough-entropy",
  fileId: track.id,
  trackTitle: track.tags.title,
  sent: {
    fingerprintAlgorithm: "Chromaprint",
    fingerprintCharacters: 52,
    fingerprintSha256: "a".repeat(32) + "b".repeat(32),
    durationSeconds: 12,
  },
  expiresAt: "2026-07-28T13:00:00.000Z",
  readOnly: true,
};

const result: AcoustIdTrackLookupResultDto = {
  fileId: track.id,
  sent: preview.sent,
  source: "network",
  fetchedAt: "2026-07-28T12:00:00.000Z",
  readOnly: true,
  candidates: [
    {
      acoustId: "22222222-2222-4222-8222-222222222222",
      recordingId: "33333333-3333-4333-8333-333333333333",
      title: "A Very Long Fixture Recording Title That Must Stay Contained",
      artists: [{ id: null, name: "Fixture Artist" }],
      durationSeconds: 12,
      releaseGroups: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          title: "Fixture Album",
          type: "Album",
        },
      ],
      score: 0.984,
    },
  ],
};

function view(
  overrides: Partial<
    React.ComponentProps<typeof TrackAcoustIdIdentification>
  > = {},
) {
  return (
    <TrackAcoustIdIdentification
      busy={false}
      error={undefined}
      preview={undefined}
      result={undefined}
      track={track}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
      onPreview={vi.fn()}
      onUseRecordingId={vi.fn()}
      {...overrides}
    />
  );
}

describe("TrackAcoustIdIdentification", () => {
  it("keeps local fingerprinting and the network lookup as separate keyboard actions", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(view({ onPreview, onConfirm }));

    const summary = screen
      .getByText("Try identifying this recording")
      .closest("summary");
    if (!summary) throw new Error("Identification summary missing");
    await user.click(summary);
    await user.click(
      screen.getByRole("button", { name: "Create fingerprint" }),
    );
    expect(onPreview).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(view({ preview, onConfirm }));
    expect(
      screen.getByRole("region", {
        name: "Confirm AcoustID fingerprint lookup",
      }),
    ).toHaveTextContent("Review what will be sent");
    const technicalDetails = screen
      .getByText("Fingerprint check details")
      .closest("details");
    if (!technicalDetails) throw new Error("Fingerprint details missing");
    expect(technicalDetails).not.toHaveAttribute("open");
    expect(screen.getByText(preview.sent.fingerprintSha256)).not.toBeVisible();
    await user.click(screen.getByText("Fingerprint check details"));
    expect(screen.getByText(preview.sent.fingerprintSha256)).toBeVisible();
    expect(screen.queryByText(/AQAAS8kSSUmi/u)).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Send and find matches" }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows read-only candidates and requires an explicit recording-ID draft action", async () => {
    const user = userEvent.setup();
    const onUseRecordingId = vi.fn();
    render(view({ result, onUseRecordingId }));

    const candidates = screen.getByRole("region", {
      name: "AcoustID recording candidates",
    });
    expect(candidates).toHaveTextContent("98% fingerprint match");
    expect(candidates).toHaveTextContent("Fixture Album (Album)");
    const serviceIds = screen
      .getByText("MusicBrainz and AcoustID IDs")
      .closest("details");
    if (!serviceIds) throw new Error("Music service IDs missing");
    expect(serviceIds).not.toHaveAttribute("open");
    expect(
      screen.getByText("33333333-3333-4333-8333-333333333333"),
    ).not.toBeVisible();
    await user.click(screen.getByText("MusicBrainz and AcoustID IDs"));
    expect(
      screen.getByText("33333333-3333-4333-8333-333333333333"),
    ).toBeVisible();
    expect(onUseRecordingId).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", {
        name: "Use this match in the draft",
      }),
    );
    expect(onUseRecordingId).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("exposes cancellation and errors with accessible names", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      view({
        error: "This build has no registered application key.",
        onCancel,
      }),
    );
    expect(
      screen.getByRole("alert", { name: "AcoustID identification error" }),
    ).toHaveTextContent("Outgroove couldn’t create this fingerprint.");
    expect(
      screen.getByText("This build has no registered application key."),
    ).not.toBeVisible();
    await user.click(screen.getByText("Technical details"));
    expect(
      screen.getByText("This build has no registered application key."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps a confirmed fingerprint ready when the online lookup fails", () => {
    render(
      view({
        error: "AcoustID returned HTTP 503 after retries.",
        preview,
      }),
    );

    const alert = screen.getByRole("alert", {
      name: "AcoustID identification error",
    });
    expect(alert).toHaveTextContent("AcoustID couldn’t finish this lookup.");
    expect(alert).toHaveTextContent("Your fingerprint is still ready");
    expect(
      screen.getByRole("button", { name: "Send and find matches" }),
    ).toBeEnabled();
  });
});
