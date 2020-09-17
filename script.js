module.exports = ModbusTcp
  


function ModbusTcp(ipAddress,port,unitId){
    let rtn = {}

    let net = require('net')
    let client = new net.Socket()
    client.setEncoding('hex')
    rtn.ipAddress = ipAddress
    rtn.port = port
    rtn.unitId = unitId
    let lastTid = 1
    rtn.online = false
    rtn.timeout = 10000
    rtn.packetBufferLength = 1000
    rtn.packets = []

    if(!unitId){rtn.unitId=1}


    let sendTCP=(data,callback)=>{

        let buffer = Buffer.from(data, "hex")
        if(client.writable){
            client.write(buffer)
        }
        else{
            connect(()=>{client.write(buffer)})
        }
    }
    client.on('data',(res)=>{
        buf = Buffer.from(res,"hex")
  
        let modbusRes = parseResponse(buf)
        let value = modbusRes.value
        let tid = modbusRes.tid
    
        let err = null 
        if(modbusRes.exceptionCode){err='Exception Code: 02 - Illegal Data Address'}
      
      
        rtn.packets[tid].rx = modbusRes
        rtn.packets[tid].rx.hex = res
        if(typeof(rtn.packets[tid].onResponce)=="function"){
            rtn.packets[tid].onResponce(err,value)
        } 
        if(err){
            rtn.packets[tid].promiseReject(err)
        }
        else{
            rtn.packets[tid].promiseResolve(value)
        }
        
        
        
    })
    client.on('close',()=>{
        rtn.online=false
    })
    client.on('connect',()=>{
        rtn.online=true
    })
    rtn.read = (address,callback)=>{
        let parsedAddress = parseAddress(address)
        let funcCode = parsedAddress.fcRead
        let length = parsedAddress.length
        address = parsedAddress.address

        let tid = getTid()
     

        let buff = makeDataPacket(tid,0,1,funcCode,address,null,length)

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

        
        sendTCP(buff,callback)

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
      
        
  
        sendTCP(buff,callback)

        return new Promise((resolve,reject)=>{
            rtn.packets[tid].promiseResolve = resolve
            rtn.packets[tid].promiseReject = reject
        })
    }
    let connect=(callback)=>{
        
        client.connect(rtn.port, rtn.ipAddress, ()=> {
            if(callback){callback()}
        })

    }
  
    let getTid=()=>{
        if(lastTid>rtn.packetBufferLength){lastTid=0}
        return lastTid++
    }

    return rtn
   
}
function parseResponse(buf){
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
        buf.writeUInt16BE(data,10)
    }
    if(funcCode==15||funcCode==16){
        buf.writeInt16BE(length,10)
        buf.writeUInt8(dataBytes,12)
        buf.writeInt32BE(data,13)
    }

    
    return buf

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
