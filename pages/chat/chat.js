// pages/chat/chat.js
var common = require('utils/common.js');
var toolTip = require('ToolTip/toolTip.js');
var MM = require('utils/msgManager.js');
var socketOpen = false;
var socketMsgQueue = []; //发送失败缓存
var lastTime = 0; //记录消息时间间隔
var finishFlag = false, offset = 0, wsInterval;
var v5config = {
      auth: null,
      fake: false,
      human: null,
      magic: [],
      env: [],
      url: {
        ques: 'https://www.v5kf.com/public/api_dkf/get_hot_ques',
        site: 'https://www.v5kf.com/public/api_dkf/get_chat_siteinfo',
        auth: 'http://chat.v5kf.com/public/webauth/v9',
        upload: 'http://chat.v5kf.com/public/upload',
        ws: 'ws://chat.v5kf.com/public/sitews'
      },
      reconn: false,
      voice: true,
      guest: {
        oid: null,
        nickname: null,
        photo: null
      },
      site: {
        id: '10000',
        aid: null,
        name: '',
        logo: null,
        about: '',
        tel: '',
        intro: '',
        ques: [],
      },
      robot: {
        name: '',
        desc: '',
        intro: '',
        logo: '',
        style: 0
      },
      worker: {
        photo: '',
        id: '',
        name: ''
      }
    };

Page({
  data:{
    showFunc: false,
    scrollBottom: 'scrollBottom',
    scrollHeight: 0,
    win: {},
    toolTip: { //信息提示
      show: true,
      info:'tips',
      type:'error',
      color: 'rgb(211,211,211)',
      icon: 'clear'
    },
    hists: [],
    messages: [],
    input: {
      value: null
    },
    info: {
      robotName: '',
      robotPhoto: '',
      workerPhoto: '',
      workerName: '',
      wid: '',
      cstmPhoto: '',
      cstmName: '',
    },
    status: 0
  },
  /**
   * 初始话流程
   */
  initChat:function(){
    console.log('【initChat】');//////
    wx.showNavigationBarLoading();

    //调用应用实例的方法获取全局数据
    var aid = v5config.site.aid;
    var info = aid && aid && common.cache('v5_' + aid + '_info');
    var stamp = aid && common.cache('v5_' + v5config.site.id + '_stamp');
    if (info && (common.fStamp() - stamp)/1000 < 3600 * 72) {//读取3天内的缓存，3天以上重新获取
      this.updateSiteInfo(info);
      this.getAccountAuth();
    } else {
      this.getSiteInfo();
    }
  },
  /**
   * 获取oid(确保唯一性),优先级：传参>本地缓存>随机生成（缓存到本地）
   */
  getOid: function(conf) {
    if (!conf) {
      return '';
    }
    var oid = conf.oid, sid = conf.site;
    if (!oid) {
      oid = common.cache('v5_' + sid + '_oid');
    } else {
      common.cache('v5_' + sid + '_oid', (oid || ''));
    }
    if (!oid) { // 当前时间36进制 和 一个随机数的36进制
      oid = (new Date()).getTime().toString(36) + Math.round(Math.random() * 0xffffffff).toString(36);
      common.cache('v5_' + sid + '_oid', (oid || ''));
    }
  	return decodeURIComponent(oid);
  },
  /**
   * 获取站点信息
   */
  getSiteInfo:function(){
    console.log('[getSiteInfo]');//////
    var that = this;
    wx.request({
      url: v5config.url.site, //仅为示例，并非真实的接口地址
      method: 'GET',
      data: {
        sid: v5config.site.id
      },
      complete: function(res) {
        console.info({'getSiteInfo ->complete': res});//////
        if ((res.statusCode === 200 || res.statusCode === '200') 
          && res.data.state === 'ok') {
          console.log({'getSiteInfo ->success': res});
          that.updateSiteInfo(res.data);
          //获得站点信息后前往认证
          that.getAccountAuth();
        } else {
          wx.hideNavigationBarLoading();
          console.warn('get_chat_siteinfo error', res.errMsg);
          toolTip.showToolTip('error', 'get_chat_siteinfo(' + res.statusCode + '): ' + res.errMsg);
        }
      }
    });
  },
  /**
   * 解析更新站点信息
   */
  updateSiteInfo: function(info) {
    var sid = info.site_id, 
      aid = info.info && info.info.account_id || '',
      robot = info.robot;
    v5config.site = info.info;
    v5config.robot = robot;
    v5config.site.id = sid;
    aid && (v5config.site.aid = aid);
    aid && common.cache('v5_' + sid + '_aid', aid);
    aid && common.cache('v5_' + aid + '_info', info);
    aid && common.cache('v5_' + sid + '_stamp', common.fStamp());
    // this.data.info.robotPhoto = common.httpsURL(robot.logo);
    // this.data.info.robotName = robot.name;
    // this.data.info.cstmName = v5config.guest.nickname;
    // this.data.info.cstmPhoto = common.httpsURL(v5config.guest.photo);
    this.setData({
      info:common.assign(this.data.info, {
        robotName: robot.name,
        robotPhoto: common.httpsURL(robot.logo),
        cstmName: v5config.guest.nickname,
        cstmPhoto: common.httpsURL(v5config.guest.photo)
      })
    });
  },
  /**
   * 账号认证
   */
  getAccountAuth:function(){
    console.log('[getAccountAuth]');//////
    var that = this;
    wx.request({
      url: v5config.url.auth, //仅为示例，并非真实的接口地址
      method: 'POST',
      data: {
        site: v5config.site.id,
        account: v5config.site.aid || v5config.site.account_id,
        visitor: v5config.guest.oid,
        nickname: v5config.guest.nickname || ''
      },
      complete: function(res) {
        console.info({'getAccountAuth ->complete': res});//////
        if ((res.statusCode === 200 || res.statusCode === '200') 
          && !res.data.o_error) {
          console.log({'getAccountAuth ->success': res.data});
          v5config.auth = res.data.authorization;
          res.data.websocket && (v5config.url.ws = res.data.websocket);
          //认证成功后连接socket
          that.connectSocket();
        } else if (res.statusCode === 200 || res.statusCode === '200') {
          wx.hideNavigationBarLoading();
          console.warn('getAccountAuth error:', res.data.o_errmsg);
          toolTip.showToolTip('warn', '账号认证失败: ' + res.data.o_errmsg);
        } else {
          wx.hideNavigationBarLoading();
          console.warn('getAccountAuth error:', res.errMsg);
          toolTip.showToolTip('error', 'webauth(' + res.statusCode + '): ' + res.errMsg);
        }
      }
    });
  },
  /**
   * 连接客服socket
   */
  connectSocket: function() {
    if (!v5config.auth) {
      toolTip.showToolTip('error', '未授权或授权未成功');
      return;
    }
    var auth = encodeURIComponent(v5config.auth);
    wx.connectSocket({
      url: v5config.url.ws+'?auth='+auth,
    });
    wx.onSocketOpen(function(res) {
      // callback
      socketOpen = true;
      toolTip.showToolTip('success', '连接成功', 2000);
      setTimeout(function(){
        wx.hideNavigationBarLoading();
      }, 200);
      //连接成功请求消息和状态
      this.sendSocketMsg(MM.getStatus());
      this.sendSocketMsg(MM.getMessages(0, 30));
      wsInterval = setInterval(function() {
        this.sendSocketMsg({o_type:'beat'});
      }.bind(this), 25000);
    }.bind(this));
    wx.onSocketMessage(function(res) {
      // data
      console.log('[onSocketMessage]', res.data);//////
      var json = JSON.parse(res.data);
      if (json.o_type === 'message') {
        var m = MM.fMsg(json);
        if (m) {
          switch(m.dir) {
            case 8://相关问题问题
              break;
            case 0:
            case 1:
            case 2:
              this.addMessage(m);
              this.updateMessageList();
              break;
            default:
              break;
          }
        }
      } else if (json.o_type === 'session') {
        if (json.o_method === 'get_messages') {
          //获取会话消息记录
          json.finish && (finishFlag = true);
          offset = json.offset + json.size;
          if (json.messages) {
            for (var msg in json.messages) {
              var m = MM.fMsg(msg);
              if (m) {
                this.addMessage(m);
              }
            }
            if (!this.data.status && json.messages.length < 1 && v5config.robot.intro) {
              var msg = MM.obtainTextMsg(v5config.robot.intro);
              msg.direction = 2;
              this.addMessage(MM.fMsg(msg));
            }
            this.updateMessageList();
          }
        } else if (json.o_method === 'get_status') {
          var status = json.status || 0;
          //服务状态
          this.setData({
            status: status
          });
          switch(status) {
            case 0: //机器人服务
              toolTip.showToolTip('info', '机器人'+this.data.info.robotName+'为您服务', 3000);
              break;
            case 1: //排队中
              toolTip.showToolTip('info', '当前客服繁忙请您耐心等待...', 3000);
              break;
            case 2: //客服服务
              v5config.worker.id = json.w_id;
              v5config.worker.name = json.nickname;
              v5config.worker.photo = json.photo;
              this.setData({
                info: common.assign(this.data.info, {workerPhoto:json.photo, workerName:json.nickname, wid:json.w_id})
              });
              toolTip.showToolTip('info', '客服'+json.nickname+'为您服务', 5000);
              break;
            case 3: //机器人托管
              
              break;
          }
        }
      }
    }.bind(this));
    wx.onSocketClose(function(res) {
      socketOpen = false;
    }.bind(this));
    wx.onSocketError(function(res) {
      socketOpen = false;
      toolTip.showToolTip('error', '连接失败：' + res.toString());
      setTimeout(function(){
        wx.hideNavigationBarLoading();
      }, 200);
    }.bind(this));
  },
  sendSocketMsg: function(msg) {
    var that = this;
    if (socketOpen && msg) {
      wx.sendSocketMessage({
        data: JSON.stringify(msg),
        success: function(res) {
          if (msg.o_type === 'message') {
            var m = MM.fMsg(msg);
            if (m) {
              that.addMessage(m);
              that.updateMessageList();
            }
            toolTip.showToolTip('success', '发送成功', 2000);
          }
        },
        fail: function(res) {
          socketMsgQueue.push(msg);
        },
        complete: function(res) {
        }
      });
    } else {
      socketMsgQueue.push(msg);
      toolTip.showToolTip('warn', '尚未连接', 2000);
    }
  },
  /**
   * 页面加载
   */
  onLoad: function(options) {
    toolTip.init(this); //初始化toolTip
    toolTip.showToolTip('warn', '正在连接...');
    // options: oid nickname human magic site
    if (options && options.site) {
      v5config.human = options.human;
      v5config.magic = options.magic && JSON.parse(options.magic);
      v5config.site = common.assign(v5config.site, {  
          id: options.site,
          aid: common.cache('v5_' + options.site + '_aid')
        });
      v5config.guest = common.assign(v5config.guest, {
        oid: this.getOid(options),
        nickname: options.nickname,
        photo: options.photo
      });
      this.initChat();
    } else {
      toolTip.showToolTip('error', '启动失败：必须传入站点编号[site]');
      console.error('启动失败：必须传人站点编号[site]');
    }
    
    var winRes;
    wx.getSystemInfo({
        success: function(res) {
            winRes = res;
        }.bind(this)
    });
    if (winRes) {
      var scrollHeight = winRes.windowHeight - winRes.windowWidth * (115/750);
      this.setData({
        win: winRes,
        scrollHeight: scrollHeight
      });
    }
  },
  onReady: function() {
    // 页面渲染完成
  },
  onShow: function() {
    // 页面显示
  },
  onHide: function() {
    // 页面隐藏
  },
  onUnload: function() {
    // 页面关闭
    wx.closeSocket();
    if (wsInterval) {
      clearInterval(wsInterval);
    }
  },
  bindContentTap: function(e) {
    // 滚动隐藏addFunc
    if (this.data.showFunc) {
      //长度换算与实际表现有较大误差！
      var scrollHeight;
      if (this.data.win) {
        scrollHeight = this.data.win.windowHeight - this.data.win.windowWidth * 115/750;
      }
      this.setData({
        scrollHeight: scrollHeight,
        showFunc: false
      });
    }
  },
  /**
   * 上拉刷新
   */
  bindscrolltoupper: function() {
    if (!finishFlag) {
      this.sendSocketMsg(MM.getMessages(offset, 30));
    } else {
      //历史消息
      
    }
  },
  addMessage: function(m) {
    //判断消息间隔是否显示时间（每两分钟显示一次时间）
    if ((common.fStamp(m.stamp) - lastTime)/1000 > 120) {
      m.showTime = true;
      lastTime = common.fStamp(m.stamp);
    }
    this.data.messages.push(m);
  },
  /**
   * 更新消息列表
   */
  updateMessageList: function (messages) {
    //更新当前消息
    this.setData({
      messages: messages || this.data.messages
    });
    //滑动到底部
    setTimeout(function() {
      this.scrollBottom();
    }.bind(this), 100);
  },
  /**
   * 滑动到底部
   */
  scrollBottom: function() {
    this.setData({
      scrollBottom: 'scrollBottom'
    });
  },
  bindfocus: function(e) {
  },
  bindblur: function(e) {
  },
  bindinput: function(e) {
    this.setData({
      input: {
        value: e.detail.value
      }
    });
  },
  checkSocketOpen: function() {
    if (socketOpen) {
      return true;
    } else {
      toolTip.showToolTip('warn', '尚未连接', 2000);
    }
    return false;
  },
  bindconfirm: function(e) {
    if (e.detail.value &&
      e.detail.value.trim()) {
      if (this.checkSocketOpen()) {
        var msg = MM.obtainTextMsg(e.detail.value.trim());
        if (v5config.magic) {
          msg.custom_content = v5config.magic;
        }
        this.sendSocketMsg(msg);
        this.setData({
          input: {
            value: ''
          }
        });
      }
    } else {
      toolTip.showToolTip('warn', '输入不能为空', 2000);
    }
  },
  /**
   * 开启功能栏
   */
  bindAddTap: function(e) {
    var scrollHeight;
    if (this.data.win) {
      //长度换算与实际表现有较大误差！？
      if (this.data.showFunc) {
        scrollHeight = this.data.win.windowHeight - this.data.win.windowWidth * 115/750;
      } else {
        scrollHeight = this.data.win.windowHeight - this.data.win.windowWidth/750 * (115 + 260);
      }
    }
    this.setData({
      scrollHeight: scrollHeight,
      showFunc: !this.data.showFunc
    });
    this.scrollBottom();
  },
  tapImageUpload: function(e) {
    if (this.checkSocketOpen()) {
      var that = this;
      wx.chooseImage({//选择图片
        count: 1, // 默认9
        sizeType: ['original', 'compressed'], // 可以指定是原图还是压缩图，默认二者都有
        sourceType: ['album', 'camera'], // 可以指定来源是相册还是相机，默认二者都有
        success: function (res) {
          // 返回选定照片的本地文件路径列表，tempFilePath可以作为img标签的src属性显示图片
          if (res.tempFilePaths && res.tempFilePaths.length > 0) {
            var tempFile = res.tempFilePaths[0];
            toolTip.showToolTip('info', '正在上传图片...', 30000);
            wx.uploadFile({
              url: v5config.url.upload, //仅为示例，非真实的接口地址
              filePath: tempFile,
              name: 'file',
              header: {
                'Authorization':v5config.auth
              },
              success: function(res){
                var data = res.data;
                data = JSON.parse(data);
                //do something
                if (data && data.url) {
                  var msg = MM.obtainImageMsg(data.url);
                  that.sendSocketMsg(msg);
                  toolTip.showToolTip('success', '图片发送成功', 2000);
                } else {
                  toolTip.showToolTip('warn', '图片上传失败', 2000);
                }
              }
            })
          } else {
            toolTip.showToolTip('warn', '您还没有选择图片', 2000);
          }
        }
      });
    }
  },
  tapSwitchHuman: function(e) {
    if (this.checkSocketOpen()) { //转人工
      this.sendSocketMsg({
        o_type: 'message',
        direction: 1, // 发送消息
        message_type: 25,
        code: 1
      });
    }
  },
  msgImageLoad: function(e) {
    var that = this;
    //这里看你在wxml中绑定的数据格式 单独取出自己绑定即可
    var wh = common.wxAutoImageCal(e);
    common.assign(this.data.messages[e.target.id].json, wh);
    this.setData({messages: this.data.messages});
  }
})
