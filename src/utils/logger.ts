import chalk from 'chalk';

const ts = () => new Date().toLocaleTimeString();

export const log = {
  info:    (msg: string) => console.log(`${chalk.gray(ts())} ${chalk.cyan('ℹ')}  ${msg}`),
  success: (msg: string) => console.log(`${chalk.gray(ts())} ${chalk.green('✔')}  ${msg}`),
  warn:    (msg: string) => console.log(`${chalk.gray(ts())} ${chalk.yellow('⚠')}  ${msg}`),
  error:   (msg: string) => console.log(`${chalk.gray(ts())} ${chalk.red('✖')}  ${msg}`),
  chat:    (u: string, m: string) => console.log(`${chalk.gray(ts())} ${chalk.magenta('💬')} ${chalk.bold(u)}: ${m}`),
  goal:    (msg: string) => console.log(`${chalk.gray(ts())} ${chalk.blue('🎯')} ${msg}`),
  brain:   (msg: string) => console.log(`${chalk.gray(ts())} ${chalk.magenta('🧠')} ${msg}`),
  divider: () => console.log(chalk.gray('─'.repeat(60))),
};