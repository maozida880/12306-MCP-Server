#!/usr/bin/env node

// 重构说明:
// 1. 移除了 getCookie() 和 make12306Request() 函数
// 2. 引入新的 http-client 模块
// 3. 所有 HTTP 请求都通过 apiClient 发出
// 4. 在服务启动时初始化 sessionManager

import { program } from 'commander';
import { startSseAndStreamableHttpMcpServer } from 'mcp-http-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { format, parse } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// 导入新的 HTTP 客户端模块
import { sessionManager, apiClient } from './http-client/index.js';

// 导入原有类型定义
import {
    InterlineData,
    InterlineInfo,
    InterlineTicketData,
    Price,
    RouteStationData,
    RouteStationInfo,
    StationData,
    StationDataKeys,
    TicketData,
    TicketDataKeys,
    TicketInfo,
    TrainSearchData,
} from './types.js';

const VERSION = '0.3.7';
const API_BASE = 'https://kyfw.12306.cn';
const SEARCH_API_BASE = 'https://search.12306.cn';
const WEB_URL = 'https://www.12306.cn/index/';
const LCQUERY_INIT_URL = 'https://kyfw.12306.cn/otn/lcQuery/init';

// 注意: 这些函数现在使用 apiClient 而不是直接使用 axios
let LCQUERY_PATH: string = '';
const MISSING_STATIONS: StationData[] = [
    {
        station_id: '@cdd',
        station_name: '成  都东',
        station_code: 'WEI',
        station_pinyin: 'chengdudong',
        station_short: 'cdd',
        station_index: '',
        code: '1707',
        city: '成都',
        r1: '',
        r2: '',
    },
];
let STATIONS: Record<string, StationData> = {};

// ... [保留所有原有的常量和辅助函数定义]
const CITY_STATIONS: Record<
    string,
    { station_code: string; station_name: string }[]
> = (() => {
    const result: Record<
        string,
        { station_code: string; station_name: string }[]
    > = {};
    for (const station of Object.values(STATIONS)) {
        const city = station.city;
        if (!result[city]) {
            result[city] = [];
        }
        result[city].push({
            station_code: station.station_code,
            station_name: station.station_name,
        });
    }
    return result;
})();

const CITY_CODES: Record<
    string,
    { station_code: string; station_name: string }
> = (() => {
    const result: Record<
        string,
        { station_code: string; station_name: string }
    > = {};
    for (const [city, stations] of Object.entries(CITY_STATIONS)) {
        for (const station of stations) {
            if (station.station_name == city) {
                result[city] = station;
                break;
            }
        }
    }
    return result;
})();

const NAME_STATIONS: Record<
    string,
    { station_code: string; station_name: string }
> = (() => {
    const result: Record<
        string,
        { station_code: string; station_name: string }
    > = {};
    for (const station of Object.values(STATIONS)) {
        const station_name = station.station_name;
        result[station_name] = {
            station_code: station.station_code,
            station_name: station.station_name,
        };
    }
    return result;
})();

// Removed unused SEAT_SHORT_TYPES

const SEAT_TYPES = {
    '9': { name: '商务座', short: 'swz' },
    P: { name: '特等座', short: 'tz' },
    M: { name: '一等座', short: 'zy' },
    D: { name: '优选一等座', short: 'zy' },
    O: { name: '二等座', short: 'ze' },
    S: { name: '二等包座', short: 'ze' },
    '6': { name: '高级软卧', short: 'gr' },
    A: { name: '高级动卧', short: 'gr' },
    '4': { name: '软卧', short: 'rw' },
    I: { name: '一等卧', short: 'rw' },
    F: { name: '动卧', short: 'rw' },
    '3': { name: '硬卧', short: 'yw' },
    J: { name: '二等卧', short: 'yw' },
    '2': { name: '软座', short: 'rz' },
    '1': { name: '硬座', short: 'yz' },
    W: { name: '无座', short: 'wz' },
    WZ: { name: '无座', short: 'wz' },
    H: { name: '其他', short: 'qt' },
};

const DW_FLAGS = [
    '智能动车组',
    '复兴号',
    '静音车厢',
    '温馨动卧',
    '动感号',
    '支持选铺',
    '老年优惠',
];

const TRAIN_FILTERS = {
    G: (ticketInfo: TicketInfo | InterlineInfo) => {
        return ticketInfo.start_train_code.startsWith('G') ||
            ticketInfo.start_train_code.startsWith('C')
            ? true
            : false;
    },
    D: (ticketInfo: TicketInfo | InterlineInfo) => {
        return ticketInfo.start_train_code.startsWith('D') ? true : false;
    },
    Z: (ticketInfo: TicketInfo | InterlineInfo) => {
        return ticketInfo.start_train_code.startsWith('Z') ? true : false;
    },
    T: (ticketInfo: TicketInfo | InterlineInfo) => {
        return ticketInfo.start_train_code.startsWith('T') ? true : false;
    },
    K: (ticketInfo: TicketInfo | InterlineInfo) => {
        return ticketInfo.start_train_code.startsWith('K') ? true : false;
    },
    O: (ticketInfo: TicketInfo | InterlineInfo) => {
        return TRAIN_FILTERS.G(ticketInfo) ||
            TRAIN_FILTERS.D(ticketInfo) ||
            TRAIN_FILTERS.Z(ticketInfo) ||
            TRAIN_FILTERS.T(ticketInfo) ||
            TRAIN_FILTERS.K(ticketInfo)
            ? false
            : true;
    },
    F: (ticketInfo: TicketInfo | InterlineInfo) => {
        if ('dw_flag' in ticketInfo) {
            return ticketInfo.dw_flag.includes('复兴号') ? true : false;
        }
        return ticketInfo.ticketList?.[0]?.dw_flag?.includes('复兴号')
            ? true
            : false;
    },
    S: (ticketInfo: TicketInfo | InterlineInfo) => {
        if ('dw_flag' in ticketInfo) {
            return ticketInfo.dw_flag.includes('智能动车组') ? true : false;
        }
        return ticketInfo.ticketList?.[0]?.dw_flag?.includes('智能动车组')
            ? true
            : false;
    },
};

const TIME_COMPARETOR = {
    startTime: (
        ticketInfoA: TicketInfo | InterlineInfo,
        ticketInfoB: TicketInfo | InterlineInfo
    ) => {
        const timeA = new Date(ticketInfoA.start_date);
        const timeB = new Date(ticketInfoB.start_date);
        if (timeA.getTime() != timeB.getTime()) {
            return timeA.getTime() - timeB.getTime();
        }
        const startTimeA = ticketInfoA.start_time.split(':');
        const startTimeB = ticketInfoB.start_time.split(':');
        const hourA = parseInt(startTimeA[0] ?? '0');
        const hourB = parseInt(startTimeB[0] ?? '0');
        if (hourA != hourB) {
            return hourA - hourB;
        }
        const minuteA = parseInt(startTimeA[1] ?? '0');
        const minuteB = parseInt(startTimeB[1] ?? '0');
        return minuteA - minuteB;
    },
    arriveTime: (
        ticketInfoA: TicketInfo | InterlineInfo,
        ticketInfoB: TicketInfo | InterlineInfo
    ) => {
        const timeA = new Date(ticketInfoA.arrive_date);
        const timeB = new Date(ticketInfoB.arrive_date);
        if (timeA.getTime() != timeB.getTime()) {
            return timeA.getTime() - timeB.getTime();
        }
        const arriveTimeA = ticketInfoA.arrive_time.split(':');
        const arriveTimeB = ticketInfoB.arrive_time.split(':');
        const hourA = parseInt(arriveTimeA[0] ?? '0');
        const hourB = parseInt(arriveTimeB[0] ?? '0');
        if (hourA != hourB) {
            return hourA - hourB;
        }
        const minuteA = parseInt(arriveTimeA[1] ?? '0');
        const minuteB = parseInt(arriveTimeB[1] ?? '0');
        return minuteA - minuteB;
    },
    duration: (
        ticketInfoA: TicketInfo | InterlineInfo,
        ticketInfoB: TicketInfo | InterlineInfo
    ) => {
        const lishiTimeA = ticketInfoA.lishi.split(':');
        const lishiTimeB = ticketInfoB.lishi.split(':');
        const hourA = parseInt(lishiTimeA[0] ?? '0');
        const hourB = parseInt(lishiTimeB[0] ?? '0');
        if (hourA != hourB) {
            return hourA - hourB;
        }
        const minuteA = parseInt(lishiTimeA[1] ?? '0');
        const minuteB = parseInt(lishiTimeB[1] ?? '0');
        return minuteA - minuteB;
    },
};

// ============ 保留所有原有的解析和格式化函数 ============

// Removed unused parseRouteStationsData

function parseRouteStationsInfo(
    routeStationsData: RouteStationData[]
): RouteStationInfo[] {
    const result: RouteStationInfo[] = [];
    routeStationsData.forEach((routeStationData, index) => {
        if (index == 0) {
            result.push({
                train_class_name: routeStationData.train_class_name,
                service_type: routeStationData.service_type,
                end_station_name: routeStationData.end_station_name,
                station_name: routeStationData.station_name,
                station_train_code: routeStationData.station_train_code,
                arrive_time: routeStationData.arrive_time,
                start_time: routeStationData.start_time,
                lishi: routeStationData.running_time,
                arrive_day_str: routeStationData.arrive_day_str,
            });
        } else {
            result.push({
                station_name: routeStationData.station_name,
                station_train_code: routeStationData.station_train_code,
                arrive_time: routeStationData.arrive_time,
                start_time: routeStationData.start_time,
                lishi: routeStationData.running_time,
                arrive_day_str: routeStationData.arrive_day_str,
            });
        }
    });
    return result;
}

function parseTicketsData(rawData: string[]): TicketData[] {
    const result: TicketData[] = [];
    for (const item of rawData) {
        const values = item.split('|');
        const entry: Partial<TicketData> = {};
        TicketDataKeys.forEach((key, index) => {
            entry[key] = values[index];
        });
        result.push(entry as TicketData);
    }
    return result;
}

function parseTicketsInfo(
    ticketsData: TicketData[],
    map: Record<string, string>
): TicketInfo[] {
    const result: TicketInfo[] = [];
    for (const ticket of ticketsData) {
        const prices = extractPrices(
            ticket.yp_info_new,
            ticket.seat_discount_info,
            ticket
        );
        const dw_flag = extractDWFlags(ticket.dw_flag);
        const startHours = parseInt(ticket.start_time.split(':')[0] ?? '0');
        const startMinutes = parseInt(ticket.start_time.split(':')[1] ?? '0');
        const durationHours = parseInt(ticket.lishi.split(':')[0] ?? '0');
        const durationMinutes = parseInt(ticket.lishi.split(':')[1] ?? '0');
        const startDate = parse(
            ticket.start_train_date,
            'yyyyMMdd',
            new Date()
        );
        startDate.setHours(startHours, startMinutes);
        const arriveDate = startDate;
        arriveDate.setHours(
            startHours + durationHours,
            startMinutes + durationMinutes
        );
        result.push({
            train_no: ticket.train_no,
            start_date: format(startDate, 'yyyy-MM-dd'),
            arrive_date: format(arriveDate, 'yyyy-MM-dd'),
            start_train_code: ticket.station_train_code,
            start_time: ticket.start_time,
            arrive_time: ticket.arrive_time,
            lishi: ticket.lishi,
            from_station: map[ticket.from_station_telecode] ?? 'Unknown',
            to_station: map[ticket.to_station_telecode] ?? 'Unknown',
            from_station_telecode: ticket.from_station_telecode,
            to_station_telecode: ticket.to_station_telecode,
            prices: prices,
            dw_flag: dw_flag,
        });
    }
    return result;
}

function formatTicketStatus(num: string): string {
    if (num.match(/^\d+$/)) {
        const count = parseInt(num);
        if (count === 0) {
            return '无票';
        } else {
            return `剩余${count}张票`;
        }
    }
    switch (num) {
        case '有':
        case '充足':
            return '有票';
        case '无':
        case '--':
        case '':
            return '无票';
        case '候补':
            return '无票需候补';
        default:
            return `${num}票`;
    }
}

function formatTicketsInfo(ticketsInfo: TicketInfo[]): string {
    if (ticketsInfo.length === 0) {
        return '没有查询到相关车次信息';
    }
    let result = '车次|出发站 -> 到达站|出发时间 -> 到达时间|历时\n';
    ticketsInfo.forEach((ticketInfo) => {
        let infoStr = '';
        infoStr += `${ticketInfo.start_train_code} ${ticketInfo.from_station}(telecode:${ticketInfo.from_station_telecode}) -> ${ticketInfo.to_station}(telecode:${ticketInfo.to_station_telecode}) ${ticketInfo.start_time} -> ${ticketInfo.arrive_time} 历时：${ticketInfo.lishi}`;
        ticketInfo.prices.forEach((price) => {
            const ticketStatus = formatTicketStatus(price.num);
            infoStr += `\n- ${price.seat_name}: ${ticketStatus} ${price.price}元`;
        });
        result += `${infoStr}\n`;
    });
    return result;
}

function formatTicketsInfoCSV(ticketsInfo: TicketInfo[]): string {
    if (ticketsInfo.length === 0) {
        return '没有查询到相关车次信息';
    }
    let result = '车次,出发站,到达站,出发时间,到达时间,历时,票价,特色标签\n';
    ticketsInfo.forEach((ticketInfo) => {
        let infoStr = '';
        infoStr += `${ticketInfo.start_train_code},${ticketInfo.from_station}(telecode:${ticketInfo.from_station_telecode}),${ticketInfo.to_station}(telecode:${ticketInfo.to_station_telecode}),${ticketInfo.start_time},${ticketInfo.arrive_time},${ticketInfo.lishi},[`;
        ticketInfo.prices.forEach((price) => {
            const ticketStatus = formatTicketStatus(price.num);
            infoStr += `${price.seat_name}: ${ticketStatus}${price.price}元,`;
        });
        infoStr += `],${
            ticketInfo.dw_flag.length == 0 ? '/' : ticketInfo.dw_flag.join('&')
        }`;
        result += `${infoStr}\n`;
    });
    return result;
}

function formatRouteStationsInfo(
    routeStationsInfo: RouteStationInfo[]
): string {
    let result = `${routeStationsInfo[0]?.station_train_code}次列车（${
        routeStationsInfo[0]?.train_class_name
    } ${
        routeStationsInfo[0]?.service_type == '0' ? '无空调' : '有空调'
    }）\n站序|车站|车次|到达时间|出发时间|历时(hh:mm)\n`;
    routeStationsInfo.forEach((routeStationInfo, index) => {
        result += `${index + 1}|${routeStationInfo.station_name}|${
            routeStationInfo.station_train_code
        }|${routeStationInfo.arrive_time}|${routeStationInfo.start_time}|${
            routeStationInfo.arrive_day_str
        } ${routeStationInfo.lishi}\n`;
    });
    return result;
}

function filterTicketsInfo<T extends TicketInfo | InterlineInfo>(
    ticketsInfo: T[],
    trainFilterFlags: string,
    earliestStartTime: number = 0,
    latestStartTime: number = 24,
    sortFlag: string = '',
    sortReverse: boolean = false,
    limitedNum: number = 0
): T[] {
    let result: T[];
    if (trainFilterFlags.length === 0) {
        result = ticketsInfo;
    } else {
        result = [];
        for (const ticketInfo of ticketsInfo) {
            for (const filter of trainFilterFlags) {
                if (
                    TRAIN_FILTERS[filter as keyof typeof TRAIN_FILTERS](
                        ticketInfo
                    )
                ) {
                    result.push(ticketInfo);
                    break;
                }
            }
        }
    }
    result = result.filter((ticketInfo) => {
        const startTimeHour = parseInt(ticketInfo.start_time.split(':')[0] ?? '0', 10);
        if (
            startTimeHour >= earliestStartTime &&
            startTimeHour < latestStartTime
        ) {
            return true;
        }
        return false;
    });

    if (Object.keys(TIME_COMPARETOR).includes(sortFlag)) {
        result.sort(TIME_COMPARETOR[sortFlag as keyof typeof TIME_COMPARETOR]);
        if (sortReverse) {
            result.reverse();
        }
    }
    if (limitedNum == 0) {
        return result;
    }
    return result.slice(0, limitedNum);
}

function parseInterlinesTicketInfo(
    interlineTicketsData: InterlineTicketData[]
) {
    const result: TicketInfo[] = [];
    for (const interlineTicketData of interlineTicketsData) {
        const prices = extractPrices(
            interlineTicketData.yp_info,
            interlineTicketData.seat_discount_info,
            interlineTicketData
        );
        const startHours = parseInt(
            interlineTicketData.start_time.split(':')[0] ?? '0'
        );
        const startMinutes = parseInt(
            interlineTicketData.start_time.split(':')[1] ?? '0'
        );
        const durationHours = parseInt(interlineTicketData.lishi.split(':')[0] ?? '0');
        const durationMinutes = parseInt(
            interlineTicketData.lishi.split(':')[1] ?? '0'
        );
        const startDate = parse(
            interlineTicketData.start_train_date,
            'yyyyMMdd',
            new Date()
        );
        startDate.setHours(startHours, startMinutes);
        const arriveDate = startDate;
        arriveDate.setHours(
            startHours + durationHours,
            startMinutes + durationMinutes
        );
        result.push({
            train_no: interlineTicketData.train_no,
            start_train_code: interlineTicketData.station_train_code,
            start_date: format(startDate, 'yyyy-MM-dd'),
            arrive_date: format(arriveDate, 'yyyy-MM-dd'),
            start_time: interlineTicketData.start_time,
            arrive_time: interlineTicketData.arrive_time,
            lishi: interlineTicketData.lishi,
            from_station: interlineTicketData.from_station_name,
            to_station: interlineTicketData.to_station_name,
            from_station_telecode: interlineTicketData.from_station_telecode,
            to_station_telecode: interlineTicketData.to_station_telecode,
            prices: prices,
            dw_flag: extractDWFlags(interlineTicketData.dw_flag),
        });
    }
    return result;
}

function parseInterlinesInfo(interlineData: InterlineData[]): InterlineInfo[] {
    const result: InterlineInfo[] = [];
    for (const ticket of interlineData) {
        const interlineTickets = parseInterlinesTicketInfo(ticket.fullList);
        const lishi = extractLishi(ticket.all_lishi);
        result.push({
            lishi: lishi,
            start_time: ticket.start_time,
            start_date: ticket.train_date,
            middle_date: ticket.middle_date,
            arrive_date: ticket.arrive_date,
            arrive_time: ticket.arrive_time,
            from_station_code: ticket.from_station_code,
            from_station_name: ticket.from_station_name,
            middle_station_code: ticket.middle_station_code,
            middle_station_name: ticket.middle_station_name,
            end_station_code: ticket.end_station_code,
            end_station_name: ticket.end_station_name,
            start_train_code: interlineTickets[0]?.start_train_code ?? '',
            first_train_no: ticket.first_train_no,
            second_train_no: ticket.second_train_no,
            train_count: ticket.train_count,
            ticketList: interlineTickets,
            same_station: ticket.same_station == '0' ? true : false,
            same_train: ticket.same_train == 'Y' ? true : false,
            wait_time: ticket.wait_time,
        });
    }
    return result;
}

function formatInterlinesInfo(interlinesInfo: InterlineInfo[]): string {
    let result =
        '出发时间 -> 到达时间 | 出发车站 -> 中转车站 -> 到达车站 | 换乘标志 |换乘等待时间| 总历时\n\n';
    interlinesInfo.forEach((interlineInfo) => {
        result += `${interlineInfo.start_date} ${interlineInfo.start_time} -> ${interlineInfo.arrive_date} ${interlineInfo.arrive_time} | `;
        result += `${interlineInfo.from_station_name} -> ${interlineInfo.middle_station_name} -> ${interlineInfo.end_station_name} | `;
        result += `${
            interlineInfo.same_train
                ? '同车换乘'
                : interlineInfo.same_station
                ? '同站换乘'
                : '换站换乘'
        } | ${interlineInfo.wait_time} | ${interlineInfo.lishi}\n\n`;
        result +=
            '\t' +
            formatTicketsInfo(interlineInfo.ticketList).replace(/\n/g, '\n\t');
        result += '\n';
    });
    return result;
}

function parseStationsData(rawData: string): Record<string, StationData> {
    const result: Record<string, StationData> = {};
    const dataArray = rawData.split('|');
    const dataList: string[][] = [];
    for (let i = 0; i < Math.floor(dataArray.length / 10); i++) {
        dataList.push(dataArray.slice(i * 10, i * 10 + 10));
    }
    for (const group of dataList) {
        let station: Partial<StationData> = {};
        StationDataKeys.forEach((key, index) => {
            station[key] = group[index];
        });
        if (!station.station_code) {
            continue;
        }
        result[station.station_code!] = station as StationData;
    }
    return result;
}

function extractLishi(all_lishi: string): string {
    const match = all_lishi.match(/(?:(\d+)小时)?(\d+?)分钟/);
    if (!match) {
        throw new Error('extractLishi失败，没有匹配到关键词');
    }
    if (!match[1]) {
        return `00:${match[2]}`;
    }
    return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function extractPrices(
    yp_info: string,
    seat_discount_info: string,
    ticketData: TicketData | InterlineTicketData
): Price[] {
    const PRICE_STR_LENGTH = 10;
    const DISCOUNT_STR_LENGTH = 5;
    const prices: Price[] = [];
    const discounts: { [key: string]: number } = {};
    for (let i = 0; i < seat_discount_info.length / DISCOUNT_STR_LENGTH; i++) {
        const discount_str = seat_discount_info.slice(
            i * DISCOUNT_STR_LENGTH,
            (i + 1) * DISCOUNT_STR_LENGTH
        );
        discounts[discount_str[0]] = parseInt(discount_str.slice(1), 10);
    }

    for (let i = 0; i < yp_info.length / PRICE_STR_LENGTH; i++) {
        const price_str = yp_info.slice(
            i * PRICE_STR_LENGTH,
            (i + 1) * PRICE_STR_LENGTH
        );
        var seat_type_code;
        if (parseInt(price_str.slice(6, 10), 10) >= 3000) {
            seat_type_code = 'W';
        } else if (!Object.keys(SEAT_TYPES).includes(price_str[0])) {
            seat_type_code = 'H';
        } else {
            seat_type_code = price_str[0];
        }
        const seat_type = SEAT_TYPES[seat_type_code as keyof typeof SEAT_TYPES];
        const price = parseInt(price_str.slice(1, 6), 10) / 10;
        const discount =
            seat_type_code in discounts ? discounts[seat_type_code] : null;
        prices.push({
            seat_name: seat_type.name,
            short: seat_type.short,
            seat_type_code,
            num: ticketData[
                `${seat_type.short}_num` as keyof (
                    | TicketData
                    | InterlineTicketData
                )
            ],
            price,
            discount,
        });
    }
    return prices;
}

function extractDWFlags(dw_flag_str: string): string[] {
    const dwFlagList = dw_flag_str.split('#');
    let result = [];
    if ('5' == dwFlagList[0]) {
        result.push(DW_FLAGS[0]);
    }
    if (dwFlagList.length > 1 && '1' == dwFlagList[1]) {
        result.push(DW_FLAGS[1]);
    }
    if (dwFlagList.length > 2) {
        if ('Q' == dwFlagList[2].substring(0, 1)) {
            result.push(DW_FLAGS[2]);
        } else if ('R' == dwFlagList[2].substring(0, 1)) {
            result.push(DW_FLAGS[3]);
        }
    }
    if (dwFlagList.length > 5 && 'D' == dwFlagList[5]) {
        result.push(DW_FLAGS[4]);
    }
    if (dwFlagList.length > 6 && 'z' != dwFlagList[6]) {
        result.push(DW_FLAGS[5]);
    }
    if (dwFlagList.length > 7 && 'z' != dwFlagList[7]) {
        result.push(DW_FLAGS[6]);
    }
    return result;
}

function checkDate(date: string): boolean {
    const timeZone = 'Asia/Shanghai';
    const nowInShanghai = toZonedTime(new Date(), timeZone);
    nowInShanghai.setHours(0, 0, 0, 0);
    const inputInShanghai = toZonedTime(new Date(date), timeZone);
    inputInShanghai.setHours(0, 0, 0, 0);
    return inputInShanghai >= nowInShanghai;
}

// ============ MCP Server 初始化 ============

export const server = new McpServer({
    name: '12306-mcp',
    version: VERSION,
    capabilities: {
        resources: {},
        tools: {},
    },
    instructions:
        '该服务主要用于帮助用户查询火车票信息、特定列车的经停站信息以及相关的车站信息。请仔细理解用户的意图，并按以下指引选择合适的接口：\n\n' +
        '**原则：**\n' +
        '*   **必要时追问**：如果用户信息不足以调用接口，请向用户追问缺失的信息。\n' +
        '*   **清晰呈现结果**：将接口返回的信息以用户易于理解的方式进行呈现。\n\n' +
        '*   **尽量精确需求**：尽量利用筛选功能筛选用户需要的车票信息，从而简短上下文长度。\n\n' +
        '请根据上述指引选择接口。',
});

interface QueryResponse {
    [key: string]: any;
    httpstatus?: string;
    data:
        | {
              [key: string]: any;
          }
        | string;
    status: boolean;
}

interface LeftTicketsQueryResponse extends QueryResponse {
    httpstatus: string;
    data: {
        [key: string]: any;
    };
    messages: string;
}

server.resource('stations', 'data://all-stations', async (uri) => ({
    contents: [{ uri: uri.href, text: JSON.stringify(STATIONS) }],
}));

// 添加健康检查工具
server.tool(
    'health-check',
    '检查服务健康状态，包括会话池状态和系统信息',
    {},
    async () => {
        const health = sessionManager.getHealthStatus();
        const poolStatus = sessionManager.getPoolStatus();
        
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    version: VERSION,
                    transport: process.env.TRANSPORT_MODE || 'stdio',
                    sessionManager: {
                        isHealthy: health.isHealthy,
                        poolStatus: poolStatus,
                        pendingRequests: health.pendingRequests
                    },
                    uptime: process.uptime()
                }, null, 2)
            }]
        };
    }
);

server.tool(
    'get-current-date',
    '获取当前日期，以上海时区（Asia/Shanghai, UTC+8）为准，返回格式为 "yyyy-MM-dd"。主要用于解析用户提到的相对日期（如"明天"、"下周三"），提供准确的日期输入。',
    {},
    async () => {
        try {
            const timeZone = 'Asia/Shanghai';
            const nowInShanghai = toZonedTime(new Date(), timeZone);
            const formattedDate = format(nowInShanghai, 'yyyy-MM-dd');
            return {
                content: [{ type: 'text', text: formattedDate }],
            };
        } catch (error) {
            console.error('Error getting current date:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Error: Failed to get current date.',
                    },
                ],
            };
        }
    }
);

server.tool(
    'get-stations-code-in-city',
    '通过中文城市名查询该城市 **所有** 火车站的名称及其对应的 `station_code`，结果是一个包含多个车站信息的列表。',
    {
        city: z.string().describe('中文城市名称，例如："北京", "上海"'),
    },
    async ({ city }) => {
        if (!(city in CITY_STATIONS)) {
            return {
                content: [{ type: 'text', text: 'Error: City not found. ' }],
            };
        }
        return {
            content: [
                { type: 'text', text: JSON.stringify(CITY_STATIONS[city]) },
            ],
        };
    }
);

server.tool(
    'get-station-code-of-citys',
    '通过中文城市名查询代表该城市的 `station_code`。此接口主要用于在用户提供**城市名**作为出发地或到达地时，为接口准备 `station_code` 参数。',
    {
        citys: z
            .string()
            .describe(
                '要查询的城市，比如"北京"。若要查询多个城市，请用|分割，比如"北京|上海"。'
            ),
    },
    async ({ citys }) => {
        let result: Record<string, object> = {};
        for (const city of citys.split('|')) {
            if (!(city in CITY_CODES)) {
                result[city] = { error: '未检索到城市。' };
            } else {
                result[city] = CITY_CODES[city];
            }
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
        };
    }
);

server.tool(
    'get-station-code-by-names',
    '通过具体的中文车站名查询其 `station_code` 和车站名。此接口主要用于在用户提供**具体车站名**作为出发地或到达地时，为接口准备 `station_code` 参数。',
    {
        stationNames: z
            .string()
            .describe(
                '具体的中文车站名称，例如："北京南", "上海虹桥"。若要查询多个站点，请用|分割，比如"北京南|上海虹桥"。'
            ),
    },
    async ({ stationNames }) => {
        let result: Record<string, object> = {};
        for (let stationName of stationNames.split('|')) {
            stationName = stationName.endsWith('站')
                ? stationName.substring(0, -1)
                : stationName;
            if (!(stationName in NAME_STATIONS)) {
                result[stationName] = { error: '未检索到城市。' };
            } else {
                result[stationName] = NAME_STATIONS[stationName];
            }
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
        };
    }
);

server.tool(
    'get-station-by-telecode',
    '通过车站的 `station_telecode` 查询车站的详细信息，包括名称、拼音、所属城市等。此接口主要用于在已知 `telecode` 的情况下获取更完整的车站数据，或用于特殊查询及调试目的。一般用户对话流程中较少直接触发。',
    {
        stationTelecode: z
            .string()
            .describe('车站的 `station_telecode` (3位字母编码)'),
    },
    async ({ stationTelecode }) => {
        if (!STATIONS[stationTelecode]) {
            return {
                content: [{ type: 'text', text: 'Error: Station not found. ' }],
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(STATIONS[stationTelecode]),
                },
            ],
        };
    }
);

// ============ 重构后的 get-tickets 工具 ============
// 使用 apiClient 替代 make12306Request

server.tool(
    'get-tickets',
    '查询12306余票信息。',
    {
        date: z
            .string()
            .length(10)
            .describe(
                '查询日期，格式为 "yyyy-MM-dd"。如果用户提供的是相对日期（如"明天"），请务必先调用 `get-current-date` 接口获取当前日期，并计算出目标日期。'
            ),
        fromStation: z
            .string()
            .describe(
                '出发地的 `station_code` 。必须是通过 `get-station-code-by-names` 或 `get-station-code-of-citys` 接口查询得到的编码，严禁直接使用中文地名。'
            ),
        toStation: z
            .string()
            .describe(
                '到达地的 `station_code` 。必须是通过 `get-station-code-by-names` 或 `get-station-code-of-citys` 接口查询得到的编码，严禁直接使用中文地名。'
            ),
        trainFilterFlags: z
            .string()
            .regex(/^[GDZTKOFS]*$/)
            .max(8)
            .optional()
            .default('')
            .describe(
                '车次筛选条件，默认为空，即不筛选。支持多个标志同时筛选。例如用户说"高铁票"，则应使用 "G"。可选标志：[G(高铁/城际),D(动车),Z(直达特快),T(特快),K(快速),O(其他),F(复兴号),S(智能动车组)]'
            ),
        earliestStartTime: z
            .number()
            .min(0)
            .max(24)
            .optional()
            .default(0)
            .describe('最早出发时间（0-24），默认为0。'),
        latestStartTime: z
            .number()
            .min(0)
            .max(24)
            .optional()
            .default(24)
            .describe('最迟出发时间（0-24），默认为24。'),
        sortFlag: z
            .string()
            .optional()
            .default('')
            .describe(
                '排序方式，默认为空，即不排序。仅支持单一标识。可选标志：[startTime(出发时间从早到晚), arriveTime(抵达时间从早到晚), duration(历时从短到长)]'
            ),
        sortReverse: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                '是否逆向排序结果，默认为false。仅在设置了sortFlag时生效。'
            ),
        limitedNum: z
            .number()
            .min(0)
            .optional()
            .default(0)
            .describe('返回的余票数量限制，默认为0，即不限制。'),
        format: z
            .string()
            .regex(/^(text|csv|json)$/i)
            .default('text')
            .optional()
            .describe(
                '返回结果格式，默认为text，建议使用text与csv。可选标志：[text, csv, json]'
            ),
    },
    async ({
        date,
        fromStation,
        toStation,
        trainFilterFlags,
        earliestStartTime,
        latestStartTime,
        sortFlag,
        sortReverse,
        limitedNum,
        format,
    }) => {
        if (!checkDate(date)) {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Error: The date cannot be earlier than today.',
                    },
                ],
            };
        }
        if (
            !Object.keys(STATIONS).includes(fromStation) ||
            !Object.keys(STATIONS).includes(toStation)
        ) {
            return {
                content: [{ type: 'text', text: 'Error: Station not found. ' }],
            };
        }
        
        const queryParams = new URLSearchParams({
            'leftTicketDTO.train_date': date,
            'leftTicketDTO.from_station': fromStation,
            'leftTicketDTO.to_station': toStation,
            purpose_codes: 'ADULT',
        });
        const queryUrl = `${API_BASE}/otn/leftTicket/query`;
        
        // 【重构关键】使用 apiClient 替代原来的 make12306Request
        try {
            const queryResponse = await apiClient.get<LeftTicketsQueryResponse>(
                queryUrl,
                queryParams
            );
            
            const ticketsData = parseTicketsData(queryResponse.data.result);
            let ticketsInfo: TicketInfo[];
            
            try {
                ticketsInfo = parseTicketsInfo(ticketsData, queryResponse.data.map);
            } catch (error) {
                console.error('Error: parse tickets info failed. ', error);
                return {
                    content: [
                        {
                            type: 'text',
                            text: 'Error: parse tickets info failed. ',
                        },
                    ],
                };
            }
            
            const filteredTicketsInfo = filterTicketsInfo<TicketInfo>(
                ticketsInfo,
                trainFilterFlags,
                earliestStartTime,
                latestStartTime,
                sortFlag,
                sortReverse,
                limitedNum
            );
            
            var formatedResult;
            switch (format) {
                case 'csv':
                    formatedResult = formatTicketsInfoCSV(filteredTicketsInfo);
                    break;
                case 'json':
                    formatedResult = JSON.stringify(filteredTicketsInfo);
                    break;
                default:
                    formatedResult = formatTicketsInfo(filteredTicketsInfo);
                    break;
            }
            
            return {
                content: [
                    {
                        type: 'text',
                        text: formatedResult,
                    },
                ],
            };
        } catch (error) {
            console.error('Error in get-tickets:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Error: Failed to get tickets data. Please try again.',
                    },
                ],
            };
        }
    }
);

interface InterlineQueryResponse extends QueryResponse {
    data:
        | {
              flag: boolean;
              result_index: number;
              middleStationList: string[];
              can_query: string;
              zd_yp_size: number;
              middleList: InterlineData[];
              zd_size: number;
              [key: string]: any;
          }
        | string;
    errorMsg: string;
}

// ============ 重构后的 get-interline-tickets 工具 ============

server.tool(
    'get-interline-tickets',
    '查询12306中转余票信息。尚且只支持查询前十条。',
    {
        date: z
            .string()
            .length(10)
            .describe(
                '查询日期，格式为 "yyyy-MM-dd"。如果用户提供的是相对日期（如"明天"），请务必先调用 `get-current-date` 接口获取当前日期，并计算出目标日期。'
            ),
        fromStation: z
            .string()
            .describe(
                '出发地的 `station_code` 。必须是通过 `get-station-code-by-names` 或 `get-station-code-of-citys` 接口查询得到的编码，严禁直接使用中文地名。'
            ),
        toStation: z
            .string()
            .describe(
                '出发地的 `station_code` 。必须是通过 `get-station-code-by-names` 或 `get-station-code-of-citys` 接口查询得到的编码，严禁直接使用中文地名。'
            ),
        middleStation: z
            .string()
            .optional()
            .default('')
            .describe(
                '中转地的 `station_code` ，可选。必须是通过 `get-station-code-by-names` 或 `get-station-code-of-citys` 接口查询得到的编码，严禁直接使用中文地名。'
            ),
        showWZ: z
            .boolean()
            .optional()
            .default(false)
            .describe('是否显示无座车，默认不显示无座车。'),
        trainFilterFlags: z
            .string()
            .regex(/^[GDZTKOFS]*$/)
            .max(8)
            .optional()
            .default('')
            .describe(
                '车次筛选条件，默认为空。从以下标志中选取多个条件组合[G(高铁/城际),D(动车),Z(直达特快),T(特快),K(快速),O(其他),F(复兴号),S(智能动车组)]'
            ),
        earliestStartTime: z
            .number()
            .min(0)
            .max(24)
            .optional()
            .default(0)
            .describe('最早出发时间（0-24），默认为0。'),
        latestStartTime: z
            .number()
            .min(0)
            .max(24)
            .optional()
            .default(24)
            .describe('最迟出发时间（0-24），默认为24。'),
        sortFlag: z
            .string()
            .optional()
            .default('')
            .describe(
                '排序方式，默认为空，即不排序。仅支持单一标识。可选标志：[startTime(出发时间从早到晚), arriveTime(抵达时间从早到晚), duration(历时从短到长)]'
            ),
        sortReverse: z
            .boolean()
            .optional()
            .default(false)
            .describe(
                '是否逆向排序结果，默认为false。仅在设置了sortFlag时生效。'
            ),
        limitedNum: z
            .number()
            .min(1)
            .optional()
            .default(10)
            .describe('返回的中转余票数量限制，默认为10。'),
        format: z
            .string()
            .regex(/^(text|json)$/i)
            .default('text')
            .optional()
            .describe(
                '返回结果格式，默认为text，建议使用text。可选标志：[text, json]'
            ),
    },
    async ({
        date,
        fromStation,
        toStation,
        middleStation,
        showWZ,
        trainFilterFlags,
        earliestStartTime,
        latestStartTime,
        sortFlag,
        sortReverse,
        limitedNum,
        format,
    }) => {
        if (!checkDate(date)) {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Error: The date cannot be earlier than today.',
                    },
                ],
            };
        }
        if (
            !Object.keys(STATIONS).includes(fromStation) ||
            !Object.keys(STATIONS).includes(toStation)
        ) {
            return {
                content: [{ type: 'text', text: 'Error: Station not found. ' }],
            };
        }
        
        const queryUrl = `${API_BASE}${LCQUERY_PATH}`;
        
        var interlineData: InterlineData[] = [];
        const queryParams = new URLSearchParams({
            train_date: date,
            from_station_telecode: fromStation,
            to_station_telecode: toStation,
            middle_station: middleStation,
            result_index: '0',
            can_query: 'Y',
            isShowWZ: showWZ ? 'Y' : 'N',
            purpose_codes: '00',
            channel: 'E',
        });
        
        try {
            while (interlineData.length < limitedNum) {
                const queryResponse = await apiClient.get<InterlineQueryResponse>(
                    queryUrl,
                    queryParams
                );
                
                if (typeof queryResponse.data == 'string') {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `很抱歉，未查到相关的列车余票。(${queryResponse.errorMsg})`,
                            },
                        ],
                    };
                }
                
                interlineData = interlineData.concat(queryResponse.data.middleList);
                
                if (queryResponse.data.can_query == 'N') {
                    break;
                }
                
                queryParams.set(
                    'result_index',
                    queryResponse.data.result_index.toString()
                );
            }
            
            let interlineTicketsInfo: InterlineInfo[];
            try {
                interlineTicketsInfo = parseInterlinesInfo(interlineData);
            } catch (error) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Error: parse tickets info failed. ${error}`,
                        },
                    ],
                };
            }
            
            const filteredInterlineTicketsInfo = filterTicketsInfo<InterlineInfo>(
                interlineTicketsInfo,
                trainFilterFlags,
                earliestStartTime,
                latestStartTime,
                sortFlag,
                sortReverse,
                limitedNum
            );
            
            var formatedResult;
            switch (format) {
                case 'json':
                    formatedResult = JSON.stringify(filteredInterlineTicketsInfo);
                    break;
                default:
                    formatedResult = formatInterlinesInfo(
                        filteredInterlineTicketsInfo
                    );
                    break;
            }
            
            return {
                content: [
                    {
                        type: 'text',
                        text: formatedResult,
                    },
                ],
            };
        } catch (error) {
            console.error('Error in get-interline-tickets:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Error: Failed to get interline tickets data. Please try again.',
                    },
                ],
            };
        }
    }
);

interface RouteQueryResponse extends QueryResponse {
    httpstatus: string;
    data: {
        data: RouteStationData[];
    };
    messages: [];
    validateMessages: object;
    validateMessagesShowId: string;
}

interface TrainSearchResponse extends QueryResponse {
    data: TrainSearchData[];
    errorMsg: string;
}

// ============ 重构后的 get-train-route-stations 工具 ============

server.tool(
    'get-train-route-stations',
    '查询特定列车车次在指定区间内的途径车站、到站时间、出发时间及停留时间等详细经停信息。当用户询问某趟具体列车的经停站时使用此接口。',
    {
        trainCode: z
            .string()
            .describe('要查询的车次 `train_code`，例如"G1033"。'),
        departDate: z
            .string()
            .length(10)
            .describe(
                '列车出发的日期 (格式: yyyy-MM-dd)。如果用户提供的是相对日期，请务必先调用 `get-current-date` 解析。'
            ),
        format: z
            .string()
            .regex(/^(text|json)$/i)
            .default('text')
            .optional()
            .describe(
                '返回结果格式，默认为text，建议使用text。可选标志：[text, json]'
            ),
    },
    async ({ trainCode, departDate, format }) => {
        try {
            const searchParams = new URLSearchParams({
                keyword: trainCode,
                date: departDate.replace(/-/g, ''),
            });
            const searchUrl = `${SEARCH_API_BASE}/search/v1/train/search`;
            
            const searchResponse = await apiClient.get<TrainSearchResponse>(
                searchUrl,
                searchParams
            );
            
            if (
                searchResponse.data.length == 0
            ) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: '很抱歉，未查询到对应车次。',
                        },
                    ],
                };
            }

            const searchData = searchResponse.data[0];
            const queryParams = new URLSearchParams({
                'leftTicketDTO.train_no': searchData.train_no,
                'leftTicketDTO.train_date': departDate,
                rand_code: '',
            });
            const queryUrl = `${API_BASE}/otn/queryTrainInfo/query`;
            
            const queryResponse = await apiClient.get<RouteQueryResponse>(
                queryUrl,
                queryParams
            );
            
            const routeStationsInfo = parseRouteStationsInfo(
                queryResponse.data.data
            );
            
            if (routeStationsInfo.length == 0) {
                return {
                    content: [{ type: 'text', text: '未查询到相关车次信息。' }],
                };
            }
            
            var formatedResult;
            switch (format) {
                case 'json':
                    formatedResult = JSON.stringify(routeStationsInfo);
                    break;
                default:
                    formatedResult = formatRouteStationsInfo(routeStationsInfo);
                    break;
            }
            
            return {
                content: [{ type: 'text', text: formatedResult }],
            };
        } catch (error) {
            console.error('Error in get-train-route-stations:', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Error: Failed to get train route stations. Please try again.',
                    },
                ],
            };
        }
    }
);

// ============ 初始化函数（使用 apiClient） ============

async function getStations(): Promise<Record<string, StationData>> {
    const html = await apiClient.get<string>(WEB_URL);
    const match = html.match('.(/script/core/common/station_name.+?.js)');
    if (match == null) {
        throw new Error('Error: get station name js file failed.');
    }
    const stationNameJSFilePath = match[0];
    const stationNameJS = await apiClient.get<string>(
        new URL(stationNameJSFilePath, WEB_URL)
    );
    const rawData = eval(stationNameJS.replace('var station_names =', ''));
    const stationsData = parseStationsData(rawData);
    
    for (const station of MISSING_STATIONS) {
        if (!stationsData[station.station_code]) {
            stationsData[station.station_code] = station;
        }
    }
    return stationsData;
}

async function getLCQueryPath(): Promise<string> {
    const html = await apiClient.get<string>(LCQUERY_INIT_URL);
    const match = html.match(/ var lc_search_url = '(.+?)'/);
    if (match == null) {
        throw new Error('Error: get station name js file failed.');
    }
    return match[1];
}

/**
 * 初始化函数
 * 在服务启动时初始化 SessionManager
 */
async function init() {
    console.log('[Main] Initializing 12306-MCP service...');
    
    // 加载基础数据
    LCQUERY_PATH = await getLCQueryPath();
    STATIONS = await getStations();
    await sessionManager.initialize();
    console.log('[Main] Service initialized successfully');
}

/**
 * 清理函数
 * 在服务关闭时清理资源
 */
function cleanup() {
    console.log('[Main] Cleaning up resources...');
    sessionManager.cleanup();
    console.log('[Main] Cleanup completed');
}

// ============ 程序入口 ============

program
    .name('mcp-server-12306')
    .description('MCP server for 12306')
    .version(VERSION)
    .option(
        '--host <host>',
        'host to bind server to. Default is localhost. Use 0.0.0.0 to bind to all interfaces.'
    )
    .option('--port <port>', 'port to listen on for SSE and HTTP transport.')
    .option('--transport <mode>', 'transport mode: stdio, http, or sse. Default is stdio.')
    .action(async (options) => {
        try {
            // 初始化 SessionManager
            await init();
            
            // 注册清理函数
            process.on('SIGINT', () => {
                console.log('[Main] Received SIGINT, shutting down...');
                cleanup();
                process.exit(0);
            });
            
            process.on('SIGTERM', () => {
                console.log('[Main] Received SIGTERM, shutting down...');
                cleanup();
                process.exit(0);
            });
            
            const transportMode = options.transport || process.env.TRANSPORT_MODE || 'stdio';
            
            if (transportMode === 'sse' || transportMode === 'http' || options.port || options.host) {
                // SSE/HTTP 模式
                const host = options.host || process.env.SERVER_HOST || '127.0.0.1';
                const port = options.port || process.env.SERVER_PORT || '8080';
                
                console.log(`[Main] Starting server in ${transportMode} mode on ${host}:${port}`);
                
                await startSseAndStreamableHttpMcpServer({
                    host: host,
                    port: parseInt(port),
                    // @ts-ignore
                    createMcpServer: async ({ headers }) => {
                        console.log('[Main] New SSE connection established');
                        return server;
                    },
                });
                console.log('[Main] ============================================');
                console.log('[Main] Server is ready and listening');
                console.log(`[Main] SSE endpoint: http://${host}:${port}/sse`);
                console.log(`[Main] Message endpoint: http://${host}:${port}/message`);
                
                // 输出一个就绪标记，供 ModelScope 检测
                console.log('[Main] READY');
                
                console.log(`[Main] ✓ SSE server ready at http://${host}:${port}/sse`);
                console.log(`[Main] ✓ Health check at http://${host}:${port}/health`);
            } else {
                // Stdio 模式（默认）
                console.log('[Main] Starting server in stdio mode');
                const transport = new StdioServerTransport();
                await server.connect(transport);
                console.error('12306 MCP Server running on stdio ');
                console.error('[Main] READY');
            }
        } catch (error) {
            console.error('Fatal error in main():', error);
            cleanup();
            process.exit(1);
        }
    });

program.parse();
