import { Component, OnInit } from '@angular/core';
import {environment} from "../../environments/environment";
import {HttpClient} from "@angular/common/http";
import {Router} from "@angular/router";

@Component({
  standalone: false,
  selector: 'app-checkout',
  templateUrl: './checkout.component.html',
  styleUrls: ['./checkout.component.css']
})
export class CheckoutComponent implements OnInit {

  constructor(private http:HttpClient, private router:Router) { }

  total:string;
  cardNumberVal:boolean=null;
  monthVal:boolean=null;
  yearVal:boolean=null;
  cvvVal:boolean=null;
  nameOnCardVal:boolean=null;

  cardNumber:string;
  month:number;
  year:number;
  cvv:number;
  nameOnCard:string;


  ngOnInit() {
    if (sessionStorage.getItem("userData") == null) {
      this.router.navigate(['login']);
    }
    this.total=sessionStorage.getItem('total');
  }

  clearLocal(){
    sessionStorage.clear();
  }

  validCard(){
    if(this.cardNumber.length==0){
      this.cardNumberVal=null;
    } else {
      // Must be exactly 16 digits, start to end - the previous regex only required "some
      // digit somewhere" (e.g. "abcdefghij12345g" satisfied it) and never anchored the end.
      this.cardNumberVal = /^[0-9]{16}$/.test(this.cardNumber);
    }
  }

  validMonth(){
    this.monthVal = this.month >= 1 && this.month <= 12;
  }

  validCvv(){
    this.cvvVal = this.cvv >=100 && this.cvv <= 999
  }

  validName(){
    this.nameOnCardVal=this.nameOnCard.length>=4 && this.nameOnCard.length<=10;
  }

  message:string='';
  paying:boolean=false;

  changeDB():void{
    if (this.paying) return;
    this.message='';

    if(this.cardNumberVal&&this.monthVal&&this.yearVal&&this.cvvVal&&this.nameOnCardVal) {
      const orderId = sessionStorage.getItem('orderId');
      let url = `${environment.apiUrl}/order/${orderId}/pay`;
      this.paying = true;
      this.http.post(url, {}).subscribe(
        res => {
          this.paying = false;
          this.router.navigate(['success']);
        },
        err => {
          this.paying = false;
          this.message = typeof err.error === 'string' ? err.error : 'Failed to complete payment. Please try again.';
        }
      )
    }else{
      if(!this.cardNumberVal)
        this.message+="Card number isn't valid. ";
      if(!this.monthVal)
        this.message+="Enter a valid month. ";
      if(!this.yearVal)
        this.message+="Enter a valid year. ";
      if(!this.cvvVal)
        this.message+="Enter a valid CVV. ";
      if(!this.nameOnCardVal)
        this.message+="Enter a valid name.";
    }
  }

  validYear() {
    this.yearVal= this.year>=19 && this.year<=99;
  }


}
