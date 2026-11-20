import { HttpStatus } from '@nestjs/common';
import { ProjectException } from '@nest-cloud/sdk';
import { createHash } from 'node:crypto';
import * as dotenv from 'dotenv';
import * as yaml from 'js-yaml';
import { CONFIG_FILE_FORMATS } from '../../constants/config-file.constants';

export class ConfigContentUtil {
  static detectFormat(name: string): string {
    const suffix = name.split('.').pop()?.toLowerCase();
    return CONFIG_FILE_FORMATS.find((format) => format === suffix) ?? 'yaml';
  }

  static md5(content: string): string {
    return createHash('md5').update(content).digest('hex');
  }

  /** 发布与拉取使用同一解析器；错误信息不包含配置原文。 */
  static parse(format: string, content: string): Record<string, unknown> {
    let value: unknown;
    try {
      switch (format) {
        case 'json':
          value = JSON.parse(content);
          break;
        case 'yaml':
        case 'yml':
          value = yaml.load(content);
          break;
        case 'env':
        case 'properties':
          value = ConfigContentUtil.parseAssignments(content, format);
          break;
        default:
          throw new ProjectException('不支持的配置格式', HttpStatus.BAD_REQUEST);
      }
      if (!ConfigContentUtil.isMapping(value)) {
        throw new ProjectException('配置根节点必须为对象', HttpStatus.BAD_REQUEST);
      }
      // YAML 别名可形成循环引用，这种配置无法通过 JSON 拉取。
      JSON.stringify(value);
      return value;
    } catch (error) {
      if (error instanceof ProjectException) throw error;
      throw new ProjectException('配置内容无法按指定格式解析', HttpStatus.BAD_REQUEST);
    }
  }

  private static parseAssignments(content: string, format: string) {
    // dotenv 会静默跳过无法识别的行。整份文件须能分解为注释、空行和完整赋值。
    const input = content.replace(/\r\n?/g, '\n');
    const assignment =
      /[ \t]*(?:export[ \t]+)?[\w.-]+(?:[ \t]*=[ \t]*|:[ \t]+)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|[^'"`\s#][^\n#]*)?[ \t]*(?:#[^\n]*)?(?:\n|$)/y;
    const comment =
      format === 'properties' ? /[ \t]*(?:[#!][^\n]*)?(?:\n|$)/y : /[ \t]*(?:#[^\n]*)?(?:\n|$)/y;
    let offset = 0;
    while (offset < input.length) {
      comment.lastIndex = assignment.lastIndex = offset;
      const match = comment.exec(input) ?? assignment.exec(input);
      if (!match) throw new ProjectException('配置中存在无效赋值', HttpStatus.BAD_REQUEST);
      offset += match[0].length;
    }
    return dotenv.parse(input);
  }

  static isMapping(value: unknown): value is Record<string, unknown> {
    return (
      value != null &&
      typeof value === 'object' &&
      (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
    );
  }
}
