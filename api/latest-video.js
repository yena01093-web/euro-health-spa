// 유로헬스클럽 유튜브 채널의 최신 업로드 영상을 가져와 반환하는 서버리스 함수.
// 브라우저에서 유튜브 RSS를 직접 fetch하면 CORS로 막히기 때문에 서버에서 대신 가져온다.
const CHANNEL_ID = 'UCsQHtLdenVXAsyIBiOP7_Kg';

module.exports = async (req, res) => {
  try {
    const feedRes = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
    if (!feedRes.ok) throw new Error(`RSS 조회 실패: ${feedRes.status}`);
    const xml = await feedRes.text();

    const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
    if (!entryMatch) throw new Error('채널에 업로드된 영상이 없습니다');

    const entry = entryMatch[1];
    const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
    if (!videoIdMatch) throw new Error('영상 ID를 찾을 수 없습니다');

    const decodeEntities = (s) => s
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    res.status(200).json({
      videoId: videoIdMatch[1],
      title: titleMatch ? decodeEntities(titleMatch[1]) : '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
