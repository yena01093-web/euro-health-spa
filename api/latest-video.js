// 유로헬스클럽 유튜브 채널의 업로드 영상 목록을 가져와 반환하는 서버리스 함수.
//
// 원래는 유튜브 RSS(videos.xml)를 썼는데, 이 채널은 RSS 피드가 계속 404를 반환해서 사용 불가.
// (채널 자체는 정상이고 영상도 공개 상태 — 이 채널만 겪는 유튜브 쪽 RSS 이슈로 보임)
// 그래서 유튜브 웹페이지가 채널 탭을 로드할 때 실제로 호출하는 내부 API(InnerTube browse)를 대신 쓴다.
// INNERTUBE_API_KEY는 시크릿이 아니라 모든 유튜브 웹페이지에 공개적으로 박혀 있는 값이고
// (yt-dlp 등 유튜브 관련 오픈소스 도구들도 동일하게 사용), CHANNEL_ID를 browseId로 넘기면 그 채널의
// 콘텐츠를 돌려준다.
//
// 이 채널은 영상을 올리면 유튜브가 자동으로 "Shorts"로 분류하는 편이라, "동영상" 탭과 "Shorts" 탭을
// 둘 다 조회해서 합친다. 두 탭은 응답 데이터 구조가 서로 달라(lockupViewModel vs
// shortsLockupViewModel) 각각 별도로 파싱해야 한다. *_TAB_PARAMS는 채널 공통 고정값(탭 종류만 가리킴).
const CHANNEL_ID = 'UCsQHtLdenVXAsyIBiOP7_Kg';
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const INNERTUBE_CLIENT_VERSION = '2.20260708.00.00';
const VIDEOS_TAB_PARAMS = 'EgZ2aWRlb3PyBgQKAjoA';
const SHORTS_TAB_PARAMS = 'EgZzaG9ydHPyBgUKA5oBAA%3D%3D';

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

async function browseTab(params) {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${INNERTUBE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: INNERTUBE_CLIENT_VERSION, hl: 'ko', gl: 'KR' } },
      browseId: CHANNEL_ID,
      params,
    }),
  });
  if (!res.ok) throw new Error(`영상 목록 조회 실패: ${res.status}`);
  return res.json();
}

// "동영상" 탭: 유튜브 최근 웹 UI인 lockupViewModel 구조를 우선 시도하고, 예전 구조(videoRenderer)도 대비
function extractRegularVideos(data) {
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

// "Shorts" 탭: 일반 영상과 데이터 모양이 달라 따로 처리 (videoId는 재생 링크 안에, 제목은 overlayMetadata 안에 있음)
function extractShorts(data) {
  const out = [];
  findAll(data, 'shortsLockupViewModel', []).forEach((item) => {
    const videoId = item.onTap && item.onTap.innertubeCommand
      && item.onTap.innertubeCommand.reelWatchEndpoint
      && item.onTap.innertubeCommand.reelWatchEndpoint.videoId;
    if (!videoId) return;
    const title = item.overlayMetadata && item.overlayMetadata.primaryText
      && item.overlayMetadata.primaryText.content;
    out.push({ videoId, title: title || '' });
  });
  return out;
}

module.exports = async (req, res) => {
  try {
    const [videosData, shortsData] = await Promise.all([
      browseTab(VIDEOS_TAB_PARAMS),
      browseTab(SHORTS_TAB_PARAMS),
    ]);

    const rawVideos = [...extractRegularVideos(videosData), ...extractShorts(shortsData)];
    if (!rawVideos.length) throw new Error('채널에 업로드된 영상이 없습니다');

    // 같은 영상이 두 탭에 동시에 걸리는 경우를 대비해 videoId 기준 중복 제거
    const seen = new Set();
    const deduped = rawVideos.filter(({ videoId }) => {
      if (seen.has(videoId)) return false;
      seen.add(videoId);
      return true;
    });

    // 제목 맨 앞의 [YOUNG] / [MID] / [TROT] / [퓨전국악] 태그로 곡을 분류. 태그 없으면 category: null (모든 연령대 공용)
    const videos = deduped.map(({ videoId, title: rawTitle }) => {
      const tagMatch = rawTitle.match(/^\s*\[(YOUNG|MID|TROT|퓨전국악)\]\s*/i);
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
