let modbus = require('modbus')

plc = modbus('COM2',9600)
//plc = modbus('10.0.0.101',502,1)
test()
async function test(){
    let res = await plc.read('HR0-1')
    console.log(res)
    await plc.write('hr01',175)
}