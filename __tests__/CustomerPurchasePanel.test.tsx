import React from 'react';
import { TextInput } from 'react-native';
// @ts-expect-error Test renderer types are not included in the native application.
import renderer, { act } from 'react-test-renderer';
import { CustomerPurchasePanel } from '../components/CustomerPurchasePanel';
jest.mock('../lib/icons', () => Object.fromEntries(['ArrowLeft','ArrowRight','Check','ChevronDown','Lock','Minus','Plus','Ticket','User','Mail','AlertCircle','CheckCircle2'].map(key => [key, () => null])));
const onSubmit = jest.fn();
const defaults = {
 event:{event_date:'2029-12-12T22:30:00Z',ticket_price:20,available_tickets:10,event_ticket_types:[{id:'general',name:'Entrada',price:20,quantity:10,sold:0}]},
 tab:'tickets' as const,onTab:jest.fn(),selectedId:'general',onSelect:jest.fn(),quantity:1,min:1,max:2,onQuantity:jest.fn(),
 name:'',email:'',onName:jest.fn(),onEmail:jest.fn(),subtotal:20,fee:.56,total:20.56,saving:0,
 unavailable:null,busy:false,authenticated:true,onSubmit,
 coupon:{value:'',onChange:jest.fn(),apply:jest.fn(),remove:jest.fn(),busy:false},
 wallet:{enabled:false,selected:false,balance:0,loading:false,onChange:jest.fn()},
};
function mount(props={}){let tree:any;act(()=>{tree=renderer.create(<CustomerPurchasePanel {...defaults} {...props}/>);});return tree;}
function button(tree:any,label:string){return tree.root.findAll((n:any)=>n.props.accessibilityRole==='button'&&n.props.accessibilityLabel===label)[0];}
function couponInput(tree:any){return tree.root.findAllByType(TextInput).find((n:any)=>n.props.accessibilityLabel==='Código de descuento');}
beforeEach(()=>jest.clearAllMocks());
it('separates selection from payment and requires a valid holder and email',()=>{
 const tree=mount();act(()=>button(tree,'Continuar').props.onPress());expect(onSubmit).not.toHaveBeenCalled();
 act(()=>button(tree,'Ir al pago seguro').props.onPress());expect(onSubmit).not.toHaveBeenCalled();
 expect(JSON.stringify(tree.toJSON())).toContain('Introduce un correo válido');
 act(()=>tree.update(<CustomerPurchasePanel {...defaults} name="Alex García" email="demo@example.invalid"/>));
 act(()=>button(tree,'Ir al pago seguro').props.onPress());expect(onSubmit).toHaveBeenCalledTimes(1);act(()=>tree.unmount());
});
it('respects quantity limits and never submits an unavailable offer',()=>{
 const tree=mount({quantity:2,unavailable:'Oferta agotada'});
 expect(button(tree,'Aumentar cantidad').props.disabled).toBe(true);
 expect(button(tree,'Continuar').props.disabled).toBe(true);
 act(()=>button(tree,'Continuar').props.onPress());expect(onSubmit).not.toHaveBeenCalled();act(()=>tree.unmount());
});
it('continues to the existing sign-in handler without showing buyer fields to guests',()=>{
 const tree=mount({authenticated:false});act(()=>button(tree,'Iniciar sesión para continuar').props.onPress());
 expect(onSubmit).toHaveBeenCalledTimes(1);act(()=>tree.unmount());
});
it('uses a free-claim action for invitations rather than presenting a paid checkout',()=>{
 const tree=mount({total:0,fee:0,subtotal:0,name:'Alex',email:'demo@example.invalid'});
 act(()=>button(tree,'Continuar').props.onPress());act(()=>button(tree,'Obtener entrada').props.onPress());expect(onSubmit).toHaveBeenCalledTimes(1);act(()=>tree.unmount());
});
it('keeps table capacity and one table selection, with no ticket quantity stepper',()=>{
 const event={...defaults.event,reservados_vip:[{id:'table',name:'Mesa Eclipse',base_price:300,capacity_people:6,included_bottles:1,quantity_available:4}]};
 const tree=mount({event,tab:'vip',selectedId:'table',subtotal:300,fee:4.82,total:304.82});
 expect(JSON.stringify(tree.toJSON())).toContain('6 personas');expect(button(tree,'Aumentar cantidad')).toBeUndefined();
 act(()=>button(tree,'Continuar').props.onPress());expect(button(tree,'Ir al pago seguro')).toBeDefined();act(()=>tree.unmount());
});
it('shows the optional coupon field before continuing and keeps it available at payment',()=>{
 const coupon={...defaults.coupon,value:'ECLIPSE10'};
 const tree=mount({coupon});expect(couponInput(tree)).toBeDefined();
 act(()=>couponInput(tree).props.onChangeText('eclipse10'));expect(coupon.onChange).toHaveBeenCalledWith('ECLIPSE10');
 act(()=>button(tree,'Aplicar descuento').props.onPress());expect(coupon.apply).toHaveBeenCalledTimes(1);
 act(()=>button(tree,'Continuar').props.onPress());expect(couponInput(tree).props.value).toBe('ECLIPSE10');
 act(()=>couponInput(tree).props.onSubmitEditing());expect(coupon.apply).toHaveBeenCalledTimes(2);act(()=>tree.unmount());
});
it.each([{value:'   ',busy:false,purchasing:false},{value:'ECLIPSE10',busy:true,purchasing:false},{value:'ECLIPSE10',busy:false,purchasing:true}])('guards both coupon actions when blank or busy: %p',({value,busy,purchasing})=>{
 const coupon={...defaults.coupon,value,busy};const tree=mount({coupon,busy:purchasing});
 expect(button(tree,'Aplicar descuento').props.disabled).toBe(true);
 act(()=>{button(tree,'Aplicar descuento').props.onPress();couponInput(tree).props.onSubmitEditing();});
 expect(coupon.apply).not.toHaveBeenCalled();act(()=>tree.unmount());
});
it('shows the applied saving, prevents editing a validated code, and restores entry after removal',()=>{
 const coupon={...defaults.coupon,value:'ECLIPSE10',label:'10% de descuento'};
 const tree=mount({coupon,saving:2,fee:.53,total:18.53});
 expect(JSON.stringify(tree.toJSON())).toContain('Aplicado · 10% de descuento');
 expect(JSON.stringify(tree.toJSON())).toContain('Descuento aplicado');
 expect(JSON.stringify(tree.toJSON())).toContain('18,53');
 expect(couponInput(tree).props.editable).toBe(false);
 act(()=>couponInput(tree).props.onSubmitEditing());expect(coupon.apply).not.toHaveBeenCalled();
 act(()=>button(tree,'Quitar descuento').props.onPress());expect(coupon.remove).toHaveBeenCalledTimes(1);
 act(()=>tree.update(<CustomerPurchasePanel {...defaults}/>));
 expect(couponInput(tree).props.editable).toBe(true);expect(couponInput(tree).props.value).toBe('');
 expect(JSON.stringify(tree.toJSON())).not.toContain('Descuento aplicado');act(()=>tree.unmount());
});
