import { Body, Controller, Get, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Code2SessionResponse, MiniProgram, Wechat } from 'wechat-jssdk';
import { UsersService } from '@app/modules/users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as APP_CONFIG from '@app/app.config';
import { HumanizedJwtAuthGuard } from '@app/guards/humanized-auth.guard';
import { JwtAuthGuard } from '@app/guards/auth.guard';
import * as CACHE_KEY from '@app/constants/cache.constant';
import { CacheService } from '@app/processors/cache/cache.service';
import { HttpProcessor } from '@app/decorators/http.decorator';

// const wx = new Wechat(wechatConfig);
// 调用小程序接口
// wx.miniProgram.getSession('code');
// 手动实例化 MiniProgram
@Controller('wechat')
export class WechatController {
  private wechatConfig: object = {
    appId: 'appId',
    appSecret: 'appSecret',
    // ...other configs
    // ...
    // 小程序配置
    miniProgram: {
      appId: 'wx53d04eb9e7c3d68d',
      appSecret: '71ac7ed4bf869bc2b7b578395a89eb44',
    },
  };
  private wx;
  private mp: MiniProgram;

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly cacheService: CacheService,
  ) {
    this.wx = new Wechat(this.wechatConfig);
    this.mp = this.wx.miniProgram;
  }

  // @Post('login')
  // login(@Body() code: string) {
  // }

  /**
   * 拿 code 换取 token
   * 如果微信用户不存在，创新新用户
   * @param code
   */
  @Get(':code')
  async login(@Param('code') code: string): Promise<{ token: string, expires_in: string }> {
    // { session_key: 'Ns9nf0SX+r9IlSzvu48GsA==',
    //   openid: 'oMFrD5PyOzXajhasUje_f81lSg8Q' }
    const { openid, session_key } = await this.mp.getSession(code);
    // const openid = data.openid;
    // 验证或保存为新用户
    if (session_key) {
      const user = await this.usersService.createOrUpdate({
        identifier: openid,
      });
      // 存储 session_key
      // REDIS OR FILES
      await this.cacheService.set(`${CACHE_KEY.WECHAT_SESSION_KEY}${openid}`, session_key);
      // 生成 token
      const token = this.jwtService.sign({
        type: 'wechat',
        identifier: openid,
        id: user.id,
      });
      return Promise.resolve({
        token,
        expires_in: APP_CONFIG.AUTH.expiresIn,
      });
    }
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard)
  @HttpProcessor.handle({ message: '数据完整性验证', error: HttpStatus.FORBIDDEN })
  async verifySignature(@Req() req, @Body() body: {
    rawData: string,
    signature: string,
  }) {
    const sessionKey = await this.cacheService.get<string>(`${CACHE_KEY.WECHAT_SESSION_KEY}${req.user}`);
    // IF ERROR throw error
    try {
      await this.mp.verifySignature(body.rawData, body.signature, sessionKey);
      return 'ok';
    } catch (e) {
      throw e;
    }
  }

  @Post('decrypt')
  @UseGuards(JwtAuthGuard)
  async decryptData(@Req() req, @Body() body: {
    encryptedData: string,
    iv: string,
  }) {
    // this.mp.decryptData(body.rawData, body.signature)
    const sessionKey = await this.cacheService.get<string>(`${CACHE_KEY.WECHAT_SESSION_KEY}${req.user}`);
    const res = await this.mp.decryptData(body.encryptedData, body.iv, sessionKey);
    const user = await this.usersService.findByIdentifier(req.user);
    // 更新用户的微信数据
    for (const meta of user.metas) {
      if (meta.key === '_wechat') {
        meta.value = res;
      }
    }
    const newUser = await this.usersService.updateUser(user);
    const resData: object = {}
    for (const meta of newUser.metas) {
      if (meta.key === '_wechat') {
        Object.assign(resData, {
          id: newUser.id,
          ...meta.value,
        });
      }
    }
    return resData;
  }

  @Post('check')
  check(@Body() body: {
    rawData: string,
    signature: string,
  }): boolean {
    // decryptData(encryptedData, iv, sessionKey, key) {
    // this.mp.decryptData(body.rawData, body.signature)
    return false;
  }

  @UseGuards(HumanizedJwtAuthGuard)
  test() {
  }

  @Post('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req) {
    console.log(req.user);
  }
}
