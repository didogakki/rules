let url = $request.url;

// 检查 URL 中是否包含 uid 参数
let hasUid = (url) => url.includes("uid");

// 从 URL 中提取 uid 参数的值
let getUid = (url) => (hasUid(url) ? url.match(/uid=(\d+)/)[1] : undefined);

// 替换多个字符串的函数
let replaceStrings = (str) => {
  str = str.replace("01A57gF-4IeYWcLdRTObYmMprlAE3yrtzh1ChnNzU9XTP1YMs", "01A1ARC2VDHpvFs4h4J0t3loBZXf4zZPcWxbsn7Y4Y_ToVXQ4");
  str = str.replace("_2A25JgpXFDeRxGeRI4lUY8S_EyT2IHXVoGa4NrDV6PUJbkdAGLVT6kWpNUpSb2BqK7UB7ynrzO1n_weQ7Eb8v4HbU", "_2A25LjWOtDeRxGeRI4lUY8S_EyT2IHXVmG_BlrDV6PUJbkdCOLWjdkWpNUpSb2E7AUMRoDjZZkeVs2fdztphSwp90");
  return str;
}

if (url.includes("users/show")) {
  // 提取并保存 uid
  $persistentStore.write(getUid(url), "uid");
  $done({});
} else if (url.includes("statuses/user_timeline")) {
  let uid = getUid(url) || $persistentStore.read("uid");
  // 修改 URL
  url = url.replace("statuses/user_timeline", "profile/statuses/tab").replace("max_id", "since_id");
  url = url + `&containerid=230413${uid}_-_WEIBO_SECOND_PROFILE_WEIBO`;
  $done({ url });
} else if (url.includes("profile/statuses/tab")) {
  let data = JSON.parse($response.body);
  let statuses = data.cards
    .map((card) => (card.card_group ? card.card_group : card))
    .flat()
    .filter((card) => card.card_type === 9)
    .map((card) => card.mblog);
  let sinceId = data.cardlistInfo.since_id;

  // 替换特定字符串
  let body = JSON.stringify({ statuses, since_id: sinceId, total_number: 100 });
  body = replaceStrings(body);

  $done({ body });
} else {
  $done({});
}
