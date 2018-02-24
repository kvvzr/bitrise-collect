import config from '../config';

global.updateReport = () => {
  Logger.log(config.BITRISE_TOKEN);
};
