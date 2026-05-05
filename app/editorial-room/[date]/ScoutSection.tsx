import type {
  EditorialRoomTweet,
  EditorialRoomViewModel,
} from "@/lib/editorial-room";

const SCROLL_OFFSET = { scrollMarginTop: "56px" } as const;

function HandleCell({ tweet }: { tweet: EditorialRoomTweet }) {
  return (
    <a
      href={tweet.url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-citation underline underline-offset-2"
    >
      @{tweet.author_handle}
    </a>
  );
}

function ScoutRow({ tweet }: { tweet: EditorialRoomTweet }) {
  const kept = tweet.scout.kept;
  return (
    <tr className="border-b border-chalk align-top">
      <td className="w-[140px] px-tight py-tight text-[14px]">
        <HandleCell tweet={tweet} />
      </td>
      <td className="px-tight py-tight text-[14px] text-cinder">{tweet.text}</td>
      <td className="w-[80px] whitespace-nowrap px-tight py-tight text-caption">
        {kept === true ? (
          <span className="text-gravel">kept</span>
        ) : kept === false ? (
          <span className="text-slate">dropped</span>
        ) : (
          <span className="text-fog">—</span>
        )}
      </td>
      <td className="w-[280px] px-tight py-tight text-[14px] text-gravel">
        {tweet.scout.reason ?? <span className="text-fog">—</span>}
      </td>
      <td className="w-[64px] px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
        {tweet.scout.score === null ? "—" : tweet.scout.score.toFixed(2)}
      </td>
    </tr>
  );
}

function UnthemedRow({ tweet }: { tweet: EditorialRoomTweet }) {
  return (
    <tr className="border-b border-chalk align-top">
      <td className="w-[140px] px-tight py-tight text-[14px]">
        <HandleCell tweet={tweet} />
      </td>
      <td className="px-tight py-tight text-[14px] text-cinder">{tweet.text}</td>
      <td className="w-[280px] px-tight py-tight text-[14px] text-gravel">
        {tweet.scout.reason ?? <span className="text-fog">—</span>}
      </td>
      <td className="w-[64px] px-tight py-tight text-right font-mono text-[13px] text-cinder tabular-nums">
        {tweet.scout.score === null ? "—" : tweet.scout.score.toFixed(2)}
      </td>
    </tr>
  );
}

export function ScoutSection({ data }: { data: EditorialRoomViewModel }) {
  const total = data.tweets.length;
  const kept = data.tweets.filter((t) => t.scout.kept === true).length;
  const dropped = data.tweets.filter((t) => t.scout.kept === false).length;
  const unknown = total - kept - dropped;

  return (
    <section id="scout" style={SCROLL_OFFSET} className="space-y-default">
      <p className="text-caption text-gravel tabular-nums">
        {total.toLocaleString("en-US")} ingested · {kept} kept · {dropped} dropped
        {unknown > 0 ? ` · ${unknown} unscored` : ""}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-chalk text-left">
              <th className="px-tight py-tight text-caption font-medium text-gravel">Handle</th>
              <th className="px-tight py-tight text-caption font-medium text-gravel">Text</th>
              <th className="px-tight py-tight text-caption font-medium text-gravel">State</th>
              <th className="px-tight py-tight text-caption font-medium text-gravel">Reason</th>
              <th className="px-tight py-tight text-right text-caption font-medium text-gravel">Score</th>
            </tr>
          </thead>
          <tbody>
            {data.tweets.map((t) => (
              <ScoutRow key={t.id} tweet={t} />
            ))}
          </tbody>
        </table>
      </div>

      {data.unthemed_kept_tweets.length > 0 && (
        <div className="space-y-tight pt-default">
          <p className="text-caption text-gravel">
            Kept but unthemed ({data.unthemed_kept_tweets.length})
          </p>
          <p className="text-caption text-gravel">
            Tweets Scout kept that the Theme agent did not cluster into any theme.
          </p>
          <div className="overflow-x-auto pt-tight">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-chalk text-left">
                  <th className="px-tight py-tight text-caption font-medium text-gravel">Handle</th>
                  <th className="px-tight py-tight text-caption font-medium text-gravel">Text</th>
                  <th className="px-tight py-tight text-caption font-medium text-gravel">Reason</th>
                  <th className="px-tight py-tight text-right text-caption font-medium text-gravel">Score</th>
                </tr>
              </thead>
              <tbody>
                {data.unthemed_kept_tweets.map((t) => (
                  <UnthemedRow key={t.id} tweet={t} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
