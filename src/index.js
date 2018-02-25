import config from '../config';

const BITRISE_API_BASE_URL = 'https://api.bitrise.io/v0.1';

const headers = {
  Authorization: `token ${config.BITRISE_TOKEN}`,
};

const fetchEnabledApps = () => {
  const response = UrlFetchApp.fetch(`${BITRISE_API_BASE_URL}/me/apps`, { headers });
  const result = JSON.parse(response.getContentText());
  return result.data.filter(app => !app.is_disabled);
};

const getYestadayMorningUnixTime = () => {
  const now = new Date(Date.now() - 86400000);
  now.setHours(6);
  now.setMinutes(0);
  now.setSeconds(0);
  return Math.floor(now.getTime() / 1000);
};

const getTodayMorningUnixTime = () => {
  const now = new Date();
  now.setHours(6);
  now.setMinutes(0);
  now.setSeconds(0);
  return Math.floor(now.getTime() / 1000);
};

const fetchTodaysBuilds = (appSlug) => {
  const response = UrlFetchApp.fetch(
    `${BITRISE_API_BASE_URL}/apps/${appSlug}/builds?after=${getYestadayMorningUnixTime()}&before=${getTodayMorningUnixTime()}`,
    { headers },
  );
  const result = JSON.parse(response.getContentText());
  return result.data;
};

const getBuildTimeDiff = (build) => {
  if (!build.finished_at || !build.environment_prepare_finished_at) {
    return 0;
  }
  const finishedAt = new Date(build.finished_at).getTime();
  const startedAt = new Date(build.environment_prepare_finished_at).getTime();
  return (finishedAt - startedAt) / 1000 / 60 / 60 / 24;
};

const getHoldTimeDiff = (build) => {
  if (!build.triggered_at || !build.started_on_worker_at) {
    return 0;
  }
  const finishedAt = new Date(build.started_on_worker_at).getTime();
  const startedAt = new Date(build.triggered_at).getTime();
  return finishedAt < startedAt ? 0 : (finishedAt - startedAt) / 1000 / 60 / 60 / 24;
};

const sum = arr => arr.reduce((acc, value) => acc + value, 0);

const getStatistic = (app) => {
  const todayBuilds = fetchTodaysBuilds(app.slug);

  const name = app.title;
  const type = app.project_type;
  const totalTime = sum(todayBuilds.map(build => getBuildTimeDiff(build)));
  const totalHoldTime = sum(todayBuilds.map(build => getHoldTimeDiff(build)));
  const count = todayBuilds.length;
  const avgBuildTime = count === 0 ? 0 : totalTime / count;
  const avgHoldTime = count === 0 ? 0 : totalHoldTime / count;

  return {
    name,
    type,
    avgHoldTime,
    count,
    avgBuildTime,
  };
};

const findOrCreateSheet = (spreadsheet, name) => {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    const newSheet = spreadsheet.insertSheet();
    newSheet.setName(name);
    return newSheet;
  }
  return sheet;
};

const getHeaderApps = sheet =>
  sheet.getRange(1, 2, 1, Math.max(sheet.getLastColumn() - 1, 1)).getValues()[0];

const fillHeader = (sheet, names) => {
  const appNames = getHeaderApps(sheet);
  names.forEach((name) => {
    if (appNames.indexOf(name) === -1) {
      sheet.getRange(1, Math.max(sheet.getLastColumn(), 1) + 1).setValue(name);
      appNames.push(name);
    }
  });
  return appNames;
};

const getYestadayValue = () =>
  Utilities.formatDate(new Date(Date.now() - 86400000), 'Asia/Tokyo', 'yyyy/MM/dd');

const unique = arr => arr.filter((x, i, self) => self.indexOf(x) === i);

const postToSlack = (text) => {
  const payload = JSON.stringify({ text });
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload,
  };
  if (config.SLACK_WEBHOOK_URL) {
    UrlFetchApp.fetch(config.SLACK_WEBHOOK_URL, options);
  }
};

const writeToBuildAvgSheet = (sheet, statistics) => {
  const headerApps = fillHeader(sheet, statistics.map(app => app.name));

  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1).setValue(getYestadayValue());

  statistics.forEach((app) => {
    const targetColumn = headerApps.indexOf(app.name);
    if (targetColumn === -1) {
      return;
    }
    sheet.getRange(targetRow, targetColumn + 2).setValue(app.avgBuildTime);
  });
};

const writeToBuildCountSheet = (sheet, statistics) => {
  const headerApps = fillHeader(sheet, statistics.map(app => app.name));

  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1).setValue(getYestadayValue());

  statistics.forEach((app) => {
    const targetColumn = headerApps.indexOf(app.name);
    if (targetColumn === -1) {
      return;
    }
    sheet.getRange(targetRow, targetColumn + 2).setValue(app.count);
  });
};

const writeToHoldAvgSheet = (sheet, statistics) => {
  const types = unique(statistics.map(app => app.type));
  const values = types.map((type) => {
    const sameTypeApps = statistics.filter(app => app.type === type);
    return {
      type,
      avg: sum(sameTypeApps.map(app => app.avgHoldTime)) / sameTypeApps.length,
    };
  });

  const headerApps = fillHeader(sheet, types);
  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1).setValue(getYestadayValue());

  values.forEach((value) => {
    const targetColumn = headerApps.indexOf(value.type);
    if (targetColumn === -1) {
      return;
    }
    sheet.getRange(targetRow, targetColumn + 2).setValue(value.avg);
  });

  // TODO: localization
  const summary = values
    .map(value => `${value.type}: ${Math.floor(value.avg * 24 * 60 * 10) / 10}分`)
    .join('、');
  postToSlack(`昨日のだいたいのホールド時間は、 ${summary} でした`);
};

global.updateReport = () => {
  const apps = fetchEnabledApps();
  const statistics = apps.map(app => getStatistic(app));

  const spreadsheet = SpreadsheetApp.openByUrl(config.SPREADSHEET_URL);

  const buildAvgSheet = findOrCreateSheet(spreadsheet, 'Build Avg Time');
  writeToBuildAvgSheet(buildAvgSheet, statistics);

  const buildCountSheet = findOrCreateSheet(spreadsheet, 'Build Count');
  writeToBuildCountSheet(buildCountSheet, statistics);

  const holdAvgSheet = findOrCreateSheet(spreadsheet, 'Hold Avg Time');
  writeToHoldAvgSheet(holdAvgSheet, statistics);
};
