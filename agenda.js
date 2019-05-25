const env       = require('./.env')
const Telegraf  = require('telegraf')
const Extra     = require('telegraf/extra')
const Markup    = require('telegraf/markup')
const moment    = require('moment')
const session   = require('telegraf/session')
const Stage     = require('telegraf/stage')
const Scene     = require('telegraf/scenes/base')

const { 
        getAgenda, 
        getTarefa, 
        getTarefas, 
        getTarefasConcluidas, 
        cadastrarTarefa, 
        concluirTarefa, 
        excluirTarefa,
        atualizarDataPrevisao,
        atualizarObservacao,
    } = require('./agendaServicos')

const bot = new Telegraf(env.token)

bot.start(ctx => {
    const from = ctx.update.message.from
    ctx.reply(`Seja bem vindo, ${from.first_name}!\nEstes são os comandos disponíveis: 
    /dia : Agenda do dia 
    /amanha: Agenda de amanhã
    /semana: Agenda da semana 
    /concluidas: tarefas concluídas
    /tarefas: tarefas sem data definida`)
})

const formataData = data => data ? moment(data).format('DD/MM/YYYY') : ''

const exibirTarefa = async (ctx, tarefaId, novaMsg = false) => {
    const tarefa = await getTarefa(tarefaId)
    const conclusao = tarefa.dt_conclusao ? 
        `\n<b>Concluída em:</b> ${formataData(tarefa.dt_conclusao)}` : ''

    const msg = 
        `<b>Titulo:</b> ${tarefa.descricao}
        <b>Previsão:</b> ${formataData(tarefa.dt_previsao)}${conclusao}
        <b>Observações:</b>\n${tarefa.observacao || ''}`

    if(novaMsg){
        ctx.reply(msg, botoesTarefa(tarefaId))
    }else{
        ctx.editMessageText(msg, botoesTarefa(tarefaId))
    }
}

const botoesAgenda = tarefas => {
    const botoes = tarefas.map(item => {
        const data = item.dt_previsao ? `${moment(item.dt_previsao).format('DD/MM/YYYY')} - ` : ''
        return [Markup.callbackButton(`${data}${item.descricao}`, `show ${item.id}`)]
    })

    return Extra.markup(Markup.inlineKeyboard(botoes, { columns: 1 }))
}

const botoesTarefa = idTarefa => Extra.HTML().markup(Markup.inlineKeyboard([
    Markup.callbackButton('✔️', `concluir ${idTarefa}`),
    Markup.callbackButton('🗓️', `setData ${idTarefa}`),
    Markup.callbackButton('💬', `addNota ${idTarefa}`),
    Markup.callbackButton('❌', `excluir ${idTarefa}`),
], { columns: 4 }))

//-------Comandos do bot
bot.command('dia', async ctx => {
    const tarefas = await getAgenda(moment())
    ctx.reply(`Aqui está a sua agenda do dia`, botoesAgenda(tarefas))
})

bot.command('amanha', async ctx => {
    const tarefas = await getAgenda(moment().add({ day: 1 }))
    ctx.reply('Aqui está sua agenda para amanhã!', botoesAgenda(tarefas)) 
})

bot.command('semana', async ctx => {
    const tarefas = await getAgenda(moment().add({ week: 1 }))
    ctx.reply('Aqui está sua agenda da semana.', botoesAgenda(tarefas))
})

bot.command('concluidas', async ctx => {
    const tarefas = await getTarefasConcluidas()
    ctx.reply('Estas são as tarefas concluídas.', botoesAgenda(tarefas))
})

bot.command('tarefas', async ctx => {
    const tarefas = await getTarefas()
    ctx.reply('Estas são as tarefas sem data definida.', botoesAgenda(tarefas))
})

//-------Ações do bot
bot.action(/show (.+)/, async ctx => {
    await exibirTarefa(ctx, ctx.match[1])
})

bot.action(/concluir (.+)/, async ctx => {
    await concluirTarefa(ctx.match[1])
    await exibirTarefa(ctx, ctx.match[1])
    await ctx.reply('Tarefa concluída.')
})

bot.action(/excluir (.+)/, async ctx => {
    await excluirTarefa(ctx.match[1])
    await ctx.editMessageText('Tarefa excluída!')
})

const tecladoDatas = Markup.keyboard([
    ['Hoje', 'Amanhã'],
    ['1 Semana', 'i Mês'],
]).resize().oneTime().extra()

let idTarefa = null

//------ dataScene

const dataScene = new Scene('data')

dataScene.enter(ctx => {
    idTarefa = ctx.match[1]
    ctx.reply('Definir data de previsão da tarefa?', tecladoDatas)
})

dataScene.leave(ctx => { idTarefa = null })

dataScene.hears(/hoje/gi, async ctx => {
    const data = await moment()
    handleData(ctx, data)
})

dataScene.hears(/(amanh[ãa])/gi, async ctx => {
    const data = await moment().add({ days: 1 })
    handleData(ctx, data) 
})

dataScene.hears(/^(\d+) dias?$/gi, async ctx => {
    const data = await moment().add({ days: ctx.match[1] })
    handleData(ctx, data)
})

dataScene.hears(/^(\d+) semanas?$/, async ctx => {
    const data = await moment().add({ weeks: ctx.match[1] })
    handleData(ctx, data)
})

dataScene.hears(/^(\d+) m[eê]s(es)?/gi, async ctx => {
    const data = await moment().add({ months: ctx.match[1] })
    handleData(ctx, data)
})

dataScene.hears(/(\d{2}\/\d{2}\/\d{4})/g, async ctx => {
    const data = await moment(ctx.match[1]).format("DD/MM/YYYY")
    handleData(ctx, data)
})

const handleData = async (ctx, data) => {
    await atualizarDataPrevisao(idTarefa, data)
    await ctx.reply('Data atualizada!')
    await exibirTarefa(ctx, idTarefa, true)
    ctx.scene.leave()
}

dataScene.on('text', ctx => {
    ctx.reply('Padrões aceitos para data \ndd/MM/YYYY\nX dias\nX semanas\nX meses')
})

//------ Scene de Observação
const obsScene = new Scene('observacoes')

obsScene.enter(ctx => {
    idTarefa = ctx.match[1]
    ctx.reply('Adicionar observação da tarefa.')
})

obsScene.leave(ctx => idTarefa = null)

obsScene.on('text', async ctx => {
    const tarefa    = await getTarefa(idTarefa)
    const novoTxt   = await ctx.update.message.text
    const obs       = await tarefa.observacao ? tarefa.observacao + '\n---\n' + novoTxt : novoTxt
    const res       = await atualizarObservacao(idTarefa, obs)
    await ctx.reply('Observação atualizada!')
    await exibirTarefa(ctx, idTarefa, true)
    ctx.scene.leave()
})

obsScene.on('message', ctx => ctx.reply('Por favor, informe apenas texto! 😉'))

const stage = new Stage([dataScene, obsScene])
bot.use(session())
bot.use(stage.middleware())

bot.action(/setData (.+)/, Stage.enter('data'))
bot.action(/addNota (.+)/, Stage.enter('observacoes'))

//------Incluir tarefa
bot.on('text', async ctx => {
    try{
        const descricao = await ctx.update.message.text
        const tarefa    = await cadastrarTarefa(descricao)
        await exibirTarefa(ctx, tarefa.id, true)
    }catch(err){
        console.log(err)
    }
})

bot.startPolling()