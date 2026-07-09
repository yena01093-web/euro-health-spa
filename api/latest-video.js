// 유로헬스클럽 유튜브 채널의 업로드 영상 목록(최신순, 최대 15개 — RSS 기본 제공량)을 가져와 반환하는 서버리스 함수.
// 브라우저에서 유튜브 RSS를 직접 fetch하면 CORS로 막히기 때문에 서버에서 대신 가져온다.
const CHANNEL_ID = 'UCsQHtLdenVXAsyIBiOP7_Kg';

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

module.exports = async (req, res) => {
  try {
    const feedRes = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
    if (!feedRes.ok) throw new Error(`RSS 조회 실패: ${feedRes.status}`);
    const xml = await feedRes.text();

    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    if (!entries.length) throw new Error('채널에 업로드된 영상이 없습니다');

    const videos = entries.map(m => {
      const entry = m[1];
      const videoIdMatch = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
      return videoIdMatch ? {
        videoId: videoIdMatch[1],
        title: titleMatch ? decodeEntities(titleMatch[1]) : '',
      } : null;
    }).filter(Boolean);

    if (!videos.length) throw new Error('영상 ID를 찾을 수 없습니다');

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    // videoId/title은 이전 버전(단일 영상) 호환용으로 최신 영상 기준 그대로 유지
    res.status(200).json({
      videoId: videos[0].videoId,
      title: videos[0].title,
      videos,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
