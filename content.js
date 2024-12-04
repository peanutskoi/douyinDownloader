const NEED_UI_DOWNLOAD = "NEED_UI_DOWNLOAD";
const DOWNLOADED = "DOWNLOADED";
const LINK_NOT_FOUND = "LINK_NOT_FOUND";
const DOWNLOAD_FAILED = "DOWNLOAD_FAILED";

const loadingdIconLink = chrome.runtime.getURL("assets/images/loading.png");
const downloadIconLink = chrome.runtime.getURL("assets/images/download.png");
const failedIconLink = chrome.runtime.getURL("assets/images/failed.png");

function injectScript(func, ...args) {
  const scriptContent = `(${func.toString()})(${args
    .map((arg) => JSON.stringify(arg))
    .join(", ")});`;
  const blob = new Blob([scriptContent], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const script = document.createElement("script");
  script.src = url;
  (document.head || document.documentElement).appendChild(script);
  script.onload = () => {
    script.remove();
    URL.revokeObjectURL(url);
  };
}

async function fetchVideoAndDownload(url, filename) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Referer: "https://www.douyin.com",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function fetchVideoUrl(aweme_id) {
  console.log("fetchVideoUrl", aweme_id);
  return new Promise((resolve, reject) => {
    function handleMessage(event) {
      if (event.source !== window) return;
      if (event.data.type === "FETCH_VIDEO_URL") {
        window.removeEventListener("message", handleMessage);
        resolve(event.data.result);
      }
    }

    window.addEventListener("message", handleMessage);

    injectScript(async (aweme_id) => {
      try {
        const detail = await fetch(
          `https://www.douyin.com/aweme/v1/web/aweme/detail?aid=6383&version_code=190500&aweme_id=${aweme_id}`,
          {
            method: "GET",
            headers: {
              Referer: "https://www.douyin.com",
            },
          }
        ).then((data) => data.json());
        const videoUrl = detail?.aweme_detail?.video?.play_addr?.url_list[0];
        window.postMessage({
          type: "FETCH_VIDEO_URL",
          success: true,
          result: videoUrl,
        });
      } catch (e) {
        console.error(e);
        window.postMessage({
          type: "FETCH_VIDEO_URL",
          success: false,
          result: "",
        });
      }
    }, aweme_id);
  });
}

const substringFileName = (filename) => {
  return filename.substring(0, 80);
}

const sendDownloadMesssage = async (targetDivDom, targetImageDom) => {
  let payload = null;
  let dataE2e = targetDivDom.getAttribute("data-e2e");
  if ("feed-active-video" === dataE2e) {
    const videoId = targetDivDom.getAttribute("data-e2e-vid");
    let videoLink = targetDivDom.querySelector("video")?.firstChild?.src;
    const fileName = targetDivDom.querySelector(
      '[data-e2e="video-desc"]'
    )?.innerText;
    console.log("sendDownloadMessage0", videoId, videoLink, fileName);
    try {
      if (!videoLink) {
        videoLink = await fetchVideoUrl(videoId);
      }
    } catch (e) {
      console.error(e);
    }

    payload = {
      action: "direct_download",
      videoId,
      videoLink,
      fileName: `${substringFileName(fileName)}.mp4`,
    };
  } else if ("player-container" === dataE2e) {
    console.log("targetDivDom", targetDivDom);
    const videoInfo = document.querySelector('[data-e2e="detail-video-info"]');
    const fileName = videoInfo.innerText.split("\n")[0];
    const videoId = videoInfo.getAttribute("data-e2e-aweme-id");
    // 详情页firstChild有防盗链，lastChild没有
    const videoLink = document.querySelector("video")?.lastChild?.src;
    payload = {
      action: "direct_download",
      videoId,
      videoLink,
      fileName: `${substringFileName(fileName)}.mp4`,
    };
    console.log(payload);
  }

  if (!payload.fileName) {
    return;
  }

  chrome.runtime.sendMessage(payload, async function (response) {
    if (chrome.runtime.lastError) {
      console.log(chrome.runtime.lastError.message);
    } else {
      if (response.status === DOWNLOADED) {
        console.log("DOWNLOADED success");
        targetImageDom && (targetImageDom.src = downloadIconLink);
      } else if (response.status === NEED_UI_DOWNLOAD) {
        console.log("blob NEED_UI_DOWNLOAD");
        await fetchVideoAndDownload(response.url, response.filename);
        targetImageDom && (targetImageDom.src = downloadIconLink);
      } else {
        console.log("DOWNLOAD failed");
        targetImageDom && (targetImageDom.src = failedIconLink);
      }
    }
  });
};

const addDownloadDiv = () => {
  // 先查询 feed-active-video是否存在
  let targetDiv = document.querySelector('[data-e2e="feed-active-video"]');
  // 再查询 video-detail-container 是否存在
  if (!targetDiv) {
    targetDiv = document.querySelector(".video-detail-container");
  }
  // 两个都没有，直接返回
  if (!targetDiv) {
    return;
  }
  // 再查询是否有 addon-download 的子节点，如果存在直接返回
  if (targetDiv.querySelector(".addon-download")) {
    return;
  }
  // 初始化div按钮与事件
  const div = document.createElement("div");
  const image = document.createElement("img");
  image.src = downloadIconLink;
  image.style.width = "45px";
  image.style.height = "45px";
  image.className = "addon-download-image";
  div.className = "addon-download";
  div.appendChild(image);

  div.onclick = async () => {
    // 已经在下载中了，直接需要跳过
    if (image.src === loadingdIconLink) {
      return;
    }
    image.src = loadingdIconLink;
    sendDownloadMesssage(targetDiv, image);
  };
  // 将按钮添加到上面查询到的节点的子元素 position-box 中
  const sideElement = targetDiv.querySelector(".positionBox");
  sideElement?.prepend(div);
};

// 保证下载按钮出现的实时性，不停的寻找视频，添加下载按钮
setInterval(addDownloadDiv, 1000);
