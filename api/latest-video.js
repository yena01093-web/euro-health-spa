// 유로헬스클럽 유튜브 채널의 업로드 영상 목록을 가져와 반환하는 서버리스 함수.
//
// 원래는 유튜브 RSS(videos.xml)를 썼는데, 이 채널은 RSS 피드가 계속 404를 반환해서 사용 불가.
// (채널 자체는 정상이고 영상도 공개 상태 — 이 채널만 겪는 유튜브 쪽 RSS 이슈로 보임)
// 그래서 유튜브 웹페이지가 채널의 "동영상" 탭을 로드할 때 실제로 호출하는 내부 API(InnerTube browse)를
// 대신 사용한다. INNERTUBE_API_KEY는 시크릿이 아니라 모든 유튜브 웹페이지에 공개적으로 박혀 있는 값이고
// (yt-dlp 등 유튜브 관련 오픈소스 도구들도 동일하게 사용), CHANNEL_ID를 browseId로 넘기면 그 채널의
// 영상 목록을 돌려준다. VIDEOS_TAB_PARAMS는 "동영상" 탭을 가리키는 고정 파라미터로, 채널마다 동일하다.
const CHANNEL_ID = 'UCsQHtLdenVXAsyIBiOP7_Kg';
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_CLIENT_VERSION = '2.20260708.00.00';
const VIDEOS_TAB_PARAMS = 'EgZ2aWRlb3PyBgQKAjoA';

// 중첩된 응답 JSON 안에서 특정 key를 가진 값을 전부 찾아 배열로 반환
function findAll(obj, key, results) {
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) {
      obj.forEach((v) => findAll(v, key, results));
    } else {
      for (const k in obj) {
        if (k === key) results.push(obj[k]);
        else findAll(obj[k], key, results);
      }
    }
  }
  return results;
}

// videoId + 제목 원문 목록 추출. 유튜브가 최근 웹 UI를 lockupViewModel 구조로 바꿔서 이걸 우선 시도하고,
// 혹시 예전 구조(videoRenderer)로 응답이 오면 그쪽도 대비해둔다.
function extractVideos(data) {
  const out = [];
  findAll(data, 'richItemRenderer', []).forEach((item) => {
    const lockup = item.content && item.content.lockupViewModel;
    const videoId = lockup && lockup.contentId;
    if (!videoId) return;
    const title = lockup.metadata && lockup.metadata.lockupMetadataViewModel
      && lockup.metadata.lockupMetadataViewModel.title
      && lockup.metadata.lockupMetadataViewModel.title.content;
    out.push({ videoId, title: title || '' });
  });

  if (!out.length) {
    findAll(data, 'videoRenderer', []).forEach((v) => {
      if (!v.videoId) return;
      const title = v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text;
      out.push({ videoId: v.videoId, title: title || '' });
    });
  }
  return out;
}

module.exports = async (req, res) => {
  try {
    const browseRes = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${INNERTUBE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: INNERTUBE_CLIENT_VERSION, hl: 'ko', gl: 'KR' } },
        browseId: CHANNEL_ID,
        params: VIDEOS_TAB_PARAMS,
      }),
    });
    if (!browseRes.ok) throw new Error(`영상 목록 조회 실패: ${browseRes.status}`);
    const data = await browseRes.json();

    const rawVideos = extractVideos(data);
    if (!rawVideos.length) throw new Error('채널에 업로드된 영상이 없습니다');

    // 제목 맨 앞의 [YOUNG] / [MID] / [TROT] 태그로 곡을 분류. 태그 없으면 category: null (모든 연령대 공용)
    const videos = rawVideos.map(({ videoId, title: rawTitle }) => {
      const tagMatch = rawTitle.match(/^\s*\[(YOUNG|MID|TROT)\]\s*/i);
      return {
        videoId,
        title: tagMatch ? rawTitle.slice(tagMatch[0].length) : rawTitle,
        category: tagMatch ? tagMatch[1].toUpperCase() : null,
      };
    });

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
    // videoId/title은 이전 버전(단일 영상) 호환용으로 목록 첫 영상 기준 그대로 유지
    res.status(200).json({
      videoId: videos[0].videoId,
      title: videos[0].title,
      videos,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
