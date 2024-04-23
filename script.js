module.exports = Modbus
  
function Modbus(address,port,unitId){
    let rtn = {}
    let lastTid = 1
    rtn.packetBufferLength = 100
    rtn.packets = []
    rtn.unitId = unitId
    if(!unitId){rtn.unitId=1}
 

    if(address.includes('.')){
        rtn.stream = Tcp(address,port)
        rtn.protocal = 'tcp'
    }
    else{
        rtn.stream = Serial(address,port)
        rtn.protocal = 'rtu'
    }

    rtn.read = (address,callback)=>{
        let parsedAddress = parseAddress(address)
        let funcCode = parsedAddress.fcRead
        let length = parsedAddress.length
        address = parsedAddress.address

        let tid = getTid()
     

        let buff = makeDataPacket(tid,0,rtn.unitId,funcCode,address,null,length)
        if(rtn.protocal=='tcp'){buff=buff.tcp}
        if(rtn.protocal=='rtu'){buff=buff.rtu}

        let packet = {
            onResponce:callback,
            tx:{
                funcCode:funcCode,
                tid:tid,
                address:address,
                hex:buff.toString('hex')
            },
            rx:null
        }
    

        rtn.packets[tid] = packet

        
        rtn.stream.send(buff)
        console.log('tx: '+buff.toString('hex'))
        return new Promise((resolve,reject)=>{
            rtn.packets[tid].promiseResolve = resolve
            rtn.packets[tid].promiseReject = reject
        })
    
    }
    rtn.write = (address,value,callback)=>{
        let parsedAddress = parseAddress(address)
        let funcCode = parsedAddress.fcWrite
        let length = parsedAddress.length
        address = parsedAddress.address

        let tid = getTid()


        if (funcCode==5&&value==true){value = 65280} // To force a coil on you send FF00 not 0001

        let buff = makeDataPacket(tid,0,rtn.unitId,funcCode,address,value,length)
        if(rtn.protocal=='tcp'){buff=buff.tcp}
        if(rtn.protocal=='rtu'){buff=buff.rtu}
   
        let packet = {
            onResponce:callback,
            tx:{
                funcCode:funcCode,
                tid:tid,
                address:address,
                hex:buff.toString('hex')
            },
            rx:null
        }
        rtn.packets[tid] = packet
      
        
  
        rtn.stream.send(buff)
        console.log('tx: '+buff.toString('hex'))

        return new Promise((resolve,reject)=>{
            rtn.packets[tid].promiseResolve = resolve
            rtn.packets[tid].promiseReject = reject
        })
    }
    let getTid=()=>{
        if(lastTid>rtn.packetBufferLength){lastTid=0}
        lastTid++
        if(rtn.protocal=='rtu'){lastTid=0}
        return lastTid
    }

    rtn.stream.onData = (buf)=>{
        console.log('rx: '+buf.toString('hex'))

        let modbusRes
        if(rtn.protocal=="rtu"){modbusRes = parseResponseRtu(buf)}
        if(rtn.protocal=="tcp"){modbusRes = parseResponseTcp(buf)}

        let value = modbusRes.value
        let tid = modbusRes.tid
        if(rtn.protocal=="rtu"){tid=0}
        
        let err = null 
        if(modbusRes.exceptionCode){err='Exception Code: 02 - Illegal Data Address'}
      
        rtn.packets[tid].rx = modbusRes
        rtn.packets[tid].rx.hex = buf.toString('hex')
        if(typeof(rtn.packets[tid].onResponce)=="function"){
            rtn.packets[tid].onResponce(err,value)
        } 
        if(err){
            rtn.packets[tid].promiseReject(err)
        }
        else{
            rtn.packets[tid].promiseResolve(value)
        }

    }
    return rtn
}
function parseResponseRtu(buf){
    let res = {}
    res.tid=1
    res.unitId    = buf.readInt8(0)                     //Unit Id        - Byte 6
    res.funcCode  = buf.readInt8(1)                     //Function Code  - Byte 7
    res.byteCount = Math.abs(buf.readInt8(2))           //Byte Count     - Byte 8
    if(buf.length>3){
        res.value    = buf.readIntBE(3,buf.length-5)       //Data           - Bytes 9+
    }


    return res
}
function parseResponseTcp(buf){
    let res = {}
    res.tid       = buf.readUInt16BE(0)                 //Transaction Id - Bytes 0 and 1
    res.pid       = buf.readUInt16BE(2)                 //Protocal Id    - Bytes 2 and 3
    res.length    = buf.readUInt16BE(4)                 //Length         - Bytes 4 and 5
    res.unitId    = buf.readInt8(6)                     //Unit Id        - Byte 6
    res.funcCode  = buf.readInt8(7)                     //Function Code  - Byte 7
    res.byteCount = Math.abs(buf.readInt8(8))           //Byte Count     - Byte 8
    if(buf.length>9){
        res.value    = buf.readIntBE(9,buf.length-9)       //Data           - Bytes 9+
    }

  


    return res
}
function makeDataPacket(transId,protoId,unitId,funcCode,address,data,length){
    
    if(typeof(data)=="boolean"&&data){data = 1}
    if(typeof(data)=="boolean"&&!data){data = 0}

    
    if(address==0){address=65535}
    else{address=address-1}

    let dataBytes = 0
    if(funcCode==15){dataBytes=length}
    if(funcCode==16){dataBytes=length*2}

    let bufferLength=12
    if(funcCode==15||funcCode==16){bufferLength = 13 + dataBytes}

    let byteCount = bufferLength - 6

    let buf = Buffer.alloc(bufferLength)

    buf.writeUInt16BE(transId,0)
    buf.writeUInt16BE(protoId,2)
    buf.writeUInt16BE(byteCount,4)
    buf.writeUInt8(unitId,6)
    buf.writeUInt8(funcCode,7)
    buf.writeUInt16BE(address,8)

   
    if(funcCode==1||funcCode==2||funcCode==3||funcCode==4){
        buf.writeUInt16BE(length,10)
    }
    if(funcCode==5||funcCode==6){
        buf.writeInt16BE(data,10)
    }
    if(funcCode==15||funcCode==16){
        buf.writeInt16BE(length,10)
        buf.writeUInt8(dataBytes,12)
        buf.writeInt32BE(data,13)
    }
    
    const { crc16modbus } = require('crc')
    let makeCrc = crc16modbus

    let bufRtu = buf.slice(6,bufferLength)
    let crc = makeCrc(bufRtu)
    bufRtu = Buffer.alloc(bufRtu.length+2,bufRtu)
    bufRtu.writeUInt16LE(crc,bufRtu.length-2)
   
    let bufTcp = buf
    return {tcp:bufTcp,rtu:bufRtu}

}
function parseAddress(address){
    rtn = {}
    address = address.toLowerCase()

    let isRegister = address.includes('r')
    if(isRegister)  {
        rtn.address = address.substr(2)
        rtn.type = address.substr(0,2)
    }
    if(!isRegister) {
        rtn.address = address.substr(1)
        rtn.type = address.substr(0,1)
    }


    let isRange = rtn.address.includes("-")
    if(isRange){
        let range = rtn.address.split("-")
        rtn.length = range[0] - range[1]
        if(rtn.length<0) {rtn.address = range[0]}
        if(rtn.length>0) {rtn.address = range[1]}
        rtn.length = Math.abs(rtn.length)+1
    }
    if(!isRange){
        rtn.length = 1
    }

    rtn.address = parseInt(rtn.address)

    if(rtn.type=='c'){
        rtn.fcRead = 1
        rtn.fcWrite = 5
    }
    if(rtn.type=='i'){
        rtn.fcRead = 2
    }
    if(rtn.type=='hr'&&!isRange){
        rtn.fcRead = 3
        rtn.fcWrite = 6
    }
    if(rtn.type=='hr'&&isRange){
        rtn.fcRead = 3
        rtn.fcWrite = 16
    }
    if(rtn.type=='ir'){
        rtn.fcRead = 4
    }


    return rtn
}
function Serial(path,baudRate){
    let rtn = {}
    const SerialPort = require('serialport')

   
    rtn.port = new SerialPort(path, {baudRate: baudRate})
  
    rtn.send = async (data)=>{
        rtn.port.write(data)
    }
    rtn.onData = ()=>{}

    rtn.port.on('data',(data)=>{
        rtn.onData(data)
    })

    
    return rtn
}
function Tcp(ipAddress,port){
    let rtn = {}

    let net = require('net')
    let client = new net.Socket()
    rtn.ipAddress = ipAddress
    rtn.port = port
    rtn.online = false
    rtn.send=(data)=>{
        if(rtn.online){
            client.write(data)
        }
        else{
            connect(()=>{client.write(data)})
        }
    }
    rtn.onData = ()=>{}

    client.on('data',(res)=>{
       rtn.onData(res)
    })
    
    client.on('close',()=>{
        rtn.online=false
    })

    client.on('connect',()=>{
        rtn.online=true
    })
    
    client.on('error',(e)=>{
        rtn.online=false
        console.log(e.message);
    })

    let connect=(callback)=>{
        client.connect(rtn.port, rtn.ipAddress, ()=> {
            if(callback){callback()}
        })

    }

    return rtn
}


